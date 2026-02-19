export interface Env {
  GULFISLANDS_CLAIMS: KVNamespace;
  ALLOWED_ORIGIN: string;
  SUPPORT_EMAIL: string;
  MOSPARO_HOST: string;
  MOSPARO_PROJECT_UUID: string;
  MOSPARO_PUBLIC_KEY: string;
  MOSPARO_PRIVATE_KEY: string;
  AWS_SES_ACCESS_KEY: string;
  AWS_SES_SECRET_KEY: string;
  AWS_SES_REGION: string;
  FROM_EMAIL: string;
}

// AWS SES v4 signing
async function sendSESEmail(
  accessKey: string,
  secretKey: string,
  region: string,
  from: string,
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const payload = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Text: { Data: body } },
      },
    },
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const service = "ses";
  const host = `email.${region}.amazonaws.com`;

  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";

  const payloadHash = await sha256Hex(payload);
  const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const signingKey = await getSigningKey(secretKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Date": amzDate,
      Authorization: authHeader,
    },
    body: payload,
  });

  return response.ok;
}

async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(key: ArrayBuffer, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacRaw(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const rawKey = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw("AWS4" + secretKey, dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
}

async function validateMosparo(env: Env, token: string, submitToken: string, formData: any): Promise<boolean> {
  if (!token || !submitToken) return false;
  
  const endpoint = `${env.MOSPARO_HOST}/api/v1/verification/verify`;
  
  // Basic validation request as per Mosparo API
  // Note: V1 focuses on token verification
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + btoa(`${env.MOSPARO_PUBLIC_KEY}:${env.MOSPARO_PRIVATE_KEY}`)
    },
    body: JSON.stringify({
      submissionToken: submitToken,
      validationToken: token,
      formData: formData
    })
  });

  const result = await response.json() as any;
  return result.valid === true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/claim") {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const body = await request.json() as any;
      const ip = request.headers.get("cf-connecting-ip") || "unknown";
      const { slug, business_name, claimant_name, claimant_email, phone, role, message, honeypot, mosparo_token, mosparo_submit_token } = body;

      // Honeypot check
      if (honeypot) {
        return Response.json({ success: false, message: "Spam detected" }, { status: 400, headers: corsHeaders });
      }

      // Required field validation
      if (!slug || !claimant_email || !claimant_name) {
        return Response.json({ success: false, message: "Missing required fields" }, { status: 400, headers: corsHeaders });
      }

      // Mosparo validation
      const isHuman = await validateMosparo(env, mosparo_token, mosparo_submit_token, {
         slug, business_name, claimant_name, claimant_email, phone, role, message
      });
      
      if (!isHuman) {
        return Response.json({ success: false, message: "Spam verification failed. Please try again." }, { status: 403, headers: corsHeaders });
      }

      // Rate limiting
      const ipSlugKey = `ratelimit:ip:${slug}:${ip}`;
      const slugLimitKey = `ratelimit:slug:${slug}`;
      const [ipValue, slugValue] = await Promise.all([
        env.GULFISLANDS_CLAIMS.get(ipSlugKey),
        env.GULFISLANDS_CLAIMS.get(slugLimitKey),
      ]);

      if (ipValue) {
        return Response.json({ success: false, message: "A claim for this business has already been submitted from your network." }, { status: 429, headers: corsHeaders });
      }
      if (slugValue && parseInt(slugValue) >= 3) {
        return Response.json({ success: false, message: "Too many claim attempts for this business. Please contact support." }, { status: 429, headers: corsHeaders });
      }

      // Store claim
      const claimId = crypto.randomUUID();
      const claimRecord = {
        id: claimId,
        slug,
        business_name,
        claimant_name,
        claimant_email,
        phone: phone || "",
        role: role || "",
        message: message || "",
        status: "pending_review",
        submitted_at: new Date().toISOString(),
        ip,
      };

      await env.GULFISLANDS_CLAIMS.put(`claim:${slug}`, JSON.stringify(claimRecord), {
        expirationTtl: 90 * 24 * 60 * 60,
      });

      // Update rate limits
      await Promise.all([
        env.GULFISLANDS_CLAIMS.put(ipSlugKey, "1", { expirationTtl: 30 * 24 * 60 * 60 }),
        env.GULFISLANDS_CLAIMS.put(slugLimitKey, (parseInt(slugValue || "0") + 1).toString(), { expirationTtl: 30 * 24 * 60 * 60 }),
      ]);

      // Send emails via AWS SES
      const region = env.AWS_SES_REGION || "ca-west-1";
      const from = env.FROM_EMAIL || "noreply@natinternet.com";

      // Notify support (FreeScout)
      const supportBody = `New listing claim submitted on gulfislands.com

Business: ${business_name} (${slug})
Claimant: ${claimant_name} <${claimant_email}>
Phone: ${phone || "not provided"}
Role: ${role || "not specified"}
Message: ${message || "none"}
Submitted: ${claimRecord.submitted_at}
Claim ID: ${claimId}

Please review and verify ownership before approving.`;

      await sendSESEmail(
        env.AWS_SES_ACCESS_KEY,
        env.AWS_SES_SECRET_KEY,
        region,
        from,
        env.SUPPORT_EMAIL,
        `[Gulf Islands] New Claim: ${business_name}`,
        supportBody
      );

      // Confirm to claimant
      const claimantBody = `Hi ${claimant_name},

Thank you for submitting a claim for "${business_name}" on Gulf Islands Directory.

We've received your request and will review it within 48 hours. If we need any additional information to verify ownership, we'll reach out to you at this email address.

Claim Reference: ${claimId}

If you have any questions, please reply to this email or contact support@natinternet.com.

The Gulf Islands Directory Team`;

      await sendSESEmail(
        env.AWS_SES_ACCESS_KEY,
        env.AWS_SES_SECRET_KEY,
        region,
        from,
        claimant_email,
        `Your claim for "${business_name}" has been received`,
        claimantBody
      );

      return Response.json(
        { success: true, message: "Claim submitted successfully. We will review it within 48 hours." },
        { headers: corsHeaders }
      );

    } catch (err: any) {
      console.error("Claim error:", err);
      return Response.json({ success: false, message: "An error occurred. Please try again." }, { status: 500, headers: corsHeaders });
    }
  },
};
