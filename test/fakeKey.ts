// Khoá giả để các trang không bị dẫn về Cài khoá Google (D15) trong test.
export const FAKE_KEY_ENV = {
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "bot@x.iam.gserviceaccount.com", private_key: "PK" }),
};
