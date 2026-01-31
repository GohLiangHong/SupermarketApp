// services/netsService.js
const axios = require("axios");

const http = axios.create({
  timeout: 10000, // ✅ 10 seconds (adjust if you want)
});

const NETS_REQUEST_URL =
  "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request";
const NETS_QUERY_URL =
  "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query";

function requireNetsEnv() {
  const apiKey = process.env.API_KEY;
  const projectId = process.env.PROJECT_ID;

  if (!apiKey || !projectId) {
    throw new Error("Missing NETS env: API_KEY / PROJECT_ID");
  }

  return { apiKey, projectId };
}

async function requestQr(amountInDollars) {
  const { apiKey, projectId } = requireNetsEnv();

  const requestBody = {
    txn_id: "sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b",
    amt_in_dollars: String(amountInDollars),
    notify_mobile: 0,
  };

  try {
    const response = await http.post(NETS_REQUEST_URL, requestBody, {
      headers: {
        "api-key": apiKey,
        "project-id": projectId,
        "Content-Type": "application/json",
      },
    });
    return response.data;
  } catch (e) {
    // ✅ make the error readable in your console
    const detail = e?.response?.data || e?.message || e;
    console.error("NETS requestQr failed:", detail);
    throw e;
  }
}

async function queryTxn(txnRetrievalRef, frontendTimeoutStatus = 0) {
  const { apiKey, projectId } = requireNetsEnv();

  try {
    const response = await http.post(
      NETS_QUERY_URL,
      {
        txn_retrieval_ref: txnRetrievalRef,
        frontend_timeout_status: frontendTimeoutStatus,
      },
      {
        headers: {
          "api-key": apiKey,
          "project-id": projectId,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (e) {
    const detail = e?.response?.data || e?.message || e;
    console.error("NETS queryTxn failed:", detail);
    throw e;
  }
}

module.exports = { requestQr, queryTxn };
