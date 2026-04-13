const { ConfidentialClientApplication } = require("@azure/msal-node");

const microsoftScopes = ["openid", "profile", "offline_access", "User.Read", "Mail.Read"];

function getMsalClient() {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const tenantId = process.env.MS_TENANT_ID || "common";

  if (!clientId || !clientSecret) {
    throw new Error("MS_CLIENT_ID and MS_CLIENT_SECRET are required");
  }

  return new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  });
}

module.exports = {
  getMsalClient,
  microsoftScopes,
};
