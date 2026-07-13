package com.funtastic.smsbridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import java.util.Locale;

public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!BridgePreferences.isPaired(context) || !BridgePreferences.hasConsent(context)) return;

        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;
        String sender = parts[0].getDisplayOriginatingAddress();
        StringBuilder body = new StringBuilder();
        for (SmsMessage part : parts) body.append(part.getMessageBody());
        String messageBody = body.toString();
        if (!isPicklePlus(sender, messageBody)) return;

        long receivedAt = parts[0].getTimestampMillis();
        Data data = new Data.Builder()
                .putString("sender", sender)
                .putString("body", messageBody)
                .putLong("receivedAt", receivedAt)
                .putString("sourceMessageId", receivedAt + "-" + (sender == null ? 0 : sender.hashCode()) + "-" + messageBody.hashCode())
                .build();
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(SmsUploadWorker.class)
                .setInputData(data)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(context).enqueue(request);
    }

    private boolean isPicklePlus(String sender, String body) {
        String source = ((sender == null ? "" : sender) + " " + body).replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
        return source.contains("피클플러스") || source.contains("pickleplus");
    }
}
