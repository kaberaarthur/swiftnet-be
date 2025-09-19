// workers/b2bWorker.js
const db = require('../../dbPromise');
const redisClient = require("../../services/redis");

async function flushBatches() {
  try {
    const items = [];
    for (let i = 0; i < 100; i++) {
      const val = await redisClient.rPop("b2b_callbacks");
      if (!val) break;

      // console.log("Dequeued from Redis:", val);
      items.push(JSON.parse(val));
    }

    if (items.length === 0) {
      // console.log("⏳ No new B2B callbacks to flush.");
      return;
    }

    // console.log(`🚀 Flushing ${items.length} B2B results to DB...`);

    const values = items.map(result => {
      const {
        OriginatorConversationID,
        ConversationID,
        TransactionID,
        ResultCode,
        ResultDesc,
        ResultParameters,
        ReferenceData
      } = result;

      const status = parseInt(ResultCode) === 0 ? 'success' : 'failed';

      const paramsMap = {};
      const resultParams = Array.isArray(ResultParameters?.ResultParameter)
        ? ResultParameters.ResultParameter
        : ResultParameters?.ResultParameter
        ? [ResultParameters.ResultParameter]
        : [];
      for (const param of resultParams) paramsMap[param.Key] = param.Value;

      const refMap = {};
      const refItems = Array.isArray(ReferenceData?.ReferenceItem)
        ? ReferenceData.ReferenceItem
        : ReferenceData?.ReferenceItem
        ? [ReferenceData.ReferenceItem]
        : [];
      for (const item of refItems) refMap[item.Key] = item.Value;

      return [
        OriginatorConversationID || null,
        ConversationID || null,
        TransactionID || null,
        ResultCode || null,
        ResultDesc || null,
        paramsMap['Amount'] || null,
        paramsMap['Currency'] || null,
        status,
        refMap['BillReferenceNumber'] || null,
        paramsMap['TransCompletedTime'] || null,
        paramsMap['DebitAccountBalance'] || null,
        paramsMap['DebitPartyAffectedAccountBalance'] || null,
        paramsMap['DebitPartyCharges'] || null,
        paramsMap['ReceiverPartyPublicName'] || null,
        paramsMap['InitiatorAccountCurrentBalance'] || null,
        JSON.stringify(refMap),
        JSON.stringify(result)
      ];
    });

    const sql = `
      INSERT INTO pppoe_b2b_payments (
        originator_conversation_id,
        conversation_id,
        transaction_id,
        result_code,
        result_desc,
        amount,
        currency,
        status,
        bill_reference_number,
        trans_completed_time,
        debit_account_balance,
        debit_party_account_balance,
        debit_party_charges,
        receiver_party_public_name,
        initiator_account_balance,
        reference_data,
        raw_payload
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        result_code = VALUES(result_code),
        result_desc = VALUES(result_desc),
        status = VALUES(status),
        raw_payload = VALUES(raw_payload)
    `;

    await db.query(sql, [values]);
    // console.log(`✅ Upserted ${items.length} B2B rows into DB. TransactionIDs:`, items.map(i => i[2]));
  } catch (err) {
    console.error("❌ Error flushing B2B results:", err);
  }
}

function startWorker() {
  setInterval(flushBatches, 5000);
}

module.exports = { startWorker };
