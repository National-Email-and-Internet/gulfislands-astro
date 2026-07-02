export interface Env {
  GULFISLANDS_SUBMISSIONS: KVNamespace;
  ALLOWED_ORIGIN: string;
  SUPPORT_EMAIL: string;
  AWS_SES_ACCESS_KEY: string;
  AWS_SES_SECRET_KEY: string;
  AWS_SES_REGION: string;
  FROM_EMAIL: string;
}

// AWS SES v4 signing (same as claim-processor)
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestOrigin = request.headers.get("Origin") || "";
    const allowedOrigins = ["https://gulfislands.com", "https://www.gulfislands.com"];
    const corsOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
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
    if (url.pathname !== "/api/submit") {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const body = await request.json() as any;
      const ip = request.headers.get("cf-connecting-ip") || "unknown";

      const {
        listing_type,
        business_name,
        island,
        category,
        description,
        phone,
        email,
        website,
        social,
        address,
        hours,
        contact_name,
        contact_email,
        honeypot,
      } = body;

      // Honeypot check
      if (honeypot) {
        return Response.json({ success: false, message: "Spam detected" }, { status: 400, headers: corsHeaders });
      }

      // Required field validation
      if (!business_name || !contact_name || !contact_email || !island || !category) {
        return Response.json({ success: false, message: "Missing required fields" }, { status: 400, headers: corsHeaders });
      }

      // Store submission
      const submissionId = crypto.randomUUID();
      const submissionRecord = {
        id: submissionId,
        listing_type: listing_type || "Basic",
        business_name,
        island,
        category,
        description: description || "",
        phone: phone || "",
        email: email || "",
        website: website || "",
        social: social || "",
        address: address || "",
        hours: hours || "",
        contact_name,
        contact_email,
        status: "pending_review",
        submitted_at: new Date().toISOString(),
        ip,
      };

      await env.GULFISLANDS_SUBMISSIONS.put(
        `submission:${submissionId}`,
        JSON.stringify(submissionRecord),
        { expirationTtl: 90 * 24 * 60 * 60 }
      );

      // Send emails via AWS SES
      const region = env.AWS_SES_REGION || "ca-west-1";
      const from = env.FROM_EMAIL || "noreply@natinternet.com";

      // Support notification
      const supportBody = `New listing submission on gulfislands.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LISTING DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Listing Type:     ${listing_type || "Basic - FREE"}
Business Name:    ${business_name}
Island:           ${island}
Category:         ${category}
Website:          ${website || "not provided"}
Phone:            ${phone || "not provided"}
Email:            ${email || "not provided"}
Social:           ${social || "not provided"}
Address:          ${address || "not provided"}
Hours:            ${hours || "not provided"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESCRIPTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${description || "(none provided)"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTACT DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name:             ${contact_name}
Email:            ${contact_email}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUBMISSION INFO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Submission ID:    ${submissionId}
Submitted:        ${submissionRecord.submitted_at}
IP Address:       ${ip}

Action required: review and add this listing to the directory.`;

      await sendSESEmail(
        env.AWS_SES_ACCESS_KEY,
        env.AWS_SES_SECRET_KEY,
        region,
        from,
        env.SUPPORT_EMAIL,
        `[Gulf Islands] New Listing Submission: ${business_name} (${listing_type || "Basic"})`,
        supportBody
      );

      // Confirmation to submitter
      const confirmationBody = `Hi ${contact_name},

Thank you for submitting "${business_name}" to the Gulf Islands Directory!

Here's a summary of your submission:

  Listing Type: ${listing_type || "Basic - FREE"}
  Business: ${business_name}
  Island: ${island}
  Category: ${category}

We'll review your listing within 24-48 hours. ${listing_type && listing_type.includes("Premium") ? "Our team will also write a professional SEO description for your business." : ""}

Once approved, your listing will appear in the directory at gulfislands.com.

Submission Reference: ${submissionId}

If you have any questions, reply to this email or contact support@natinternet.com.

The Gulf Islands Directory Team`;

      await sendSESEmail(
        env.AWS_SES_ACCESS_KEY,
        env.AWS_SES_SECRET_KEY,
        region,
        from,
        contact_email,
        `Your listing "${business_name}" has been received`,
        confirmationBody
      );

      return Response.json(
        { success: true, message: "Listing submitted successfully. We will review it within 24-48 hours." },
        { headers: corsHeaders }
      );

    } catch (err: any) {
      console.error("Submit error:", err);
      return Response.json({ success: false, message: "An error occurred. Please try again." }, { status: 500, headers: corsHeaders });
    }
  },
};
