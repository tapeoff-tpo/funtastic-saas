package com.funtastic.smsbridge;

import android.content.Context;
import android.content.SharedPreferences;

final class BridgePreferences {
    private static final String FILE = "sms_bridge";
    private static final String SERVER = "server";
    private static final String TOKEN = "device_token";
    private static final String DEVICE_ID = "device_id";
    private static final String CONSENTED = "sms_consent";

    private BridgePreferences() {}

    static SharedPreferences get(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static boolean isPaired(Context context) {
        SharedPreferences prefs = get(context);
        return !prefs.getString(SERVER, "").isEmpty() && !prefs.getString(TOKEN, "").isEmpty();
    }

    static String server(Context context) {
        return get(context).getString(SERVER, "");
    }

    static String token(Context context) {
        return get(context).getString(TOKEN, "");
    }

    static boolean hasConsent(Context context) {
        return get(context).getBoolean(CONSENTED, false);
    }

    static void setConsent(Context context, boolean consented) {
        get(context).edit().putBoolean(CONSENTED, consented).apply();
    }

    static void savePairing(Context context, String server, String deviceId, String token) {
        get(context).edit()
                .putString(SERVER, server)
                .putString(DEVICE_ID, deviceId)
                .putString(TOKEN, token)
                .apply();
    }
}
