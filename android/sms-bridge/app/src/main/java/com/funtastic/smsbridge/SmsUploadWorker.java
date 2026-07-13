package com.funtastic.smsbridge;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.time.Instant;

public class SmsUploadWorker extends Worker {
    public SmsUploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (!BridgePreferences.isPaired(context) || !BridgePreferences.hasConsent(context)) return Result.failure();
        try {
            JSONObject body = new JSONObject();
            body.put("sender", getInputData().getString("sender"));
            body.put("body", getInputData().getString("body"));
            body.put("receivedAt", Instant.ofEpochMilli(getInputData().getLong("receivedAt", System.currentTimeMillis())).toString());
            body.put("sourceMessageId", getInputData().getString("sourceMessageId"));
            ApiClient.post(
                    BridgePreferences.server(context) + "/api/sms-bridge/messages",
                    body,
                    BridgePreferences.token(context)
            );
            return Result.success();
        } catch (Exception error) {
            return getRunAttemptCount() < 8 ? Result.retry() : Result.failure();
        }
    }
}
