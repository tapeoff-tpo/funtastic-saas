package com.funtastic.smsbridge;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int SMS_PERMISSION_REQUEST = 501;
    private TextView connectionStatus;
    private TextView permissionStatus;
    private Button permissionButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildContent());
        refreshStatus();
        handlePairingUri(getIntent().getData());
        sendHeartbeat();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handlePairingUri(intent.getData());
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshStatus();
    }

    private View buildContent() {
        int padding = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(padding, padding, padding, padding);

        TextView title = text("Funtastic 인증문자", 24, Color.rgb(17, 24, 39));
        title.setTypeface(null, Typeface.BOLD);
        root.addView(title);
        TextView subtitle = text("피클플러스 인증문자를 SaaS로 안전하게 전달합니다.", 14, Color.DKGRAY);
        subtitle.setPadding(0, dp(8), 0, dp(18));
        root.addView(subtitle);

        connectionStatus = statusBox();
        permissionStatus = statusBox();
        root.addView(connectionStatus);
        root.addView(permissionStatus);

        Button pairButton = button("SaaS 연결 QR 스캔");
        pairButton.setOnClickListener(v -> scanPairingQr());
        root.addView(pairButton);

        permissionButton = button("문자 접근 허용");
        permissionButton.setOnClickListener(v -> requestSmsPermissionWithConsent());
        root.addView(permissionButton);

        Button batteryButton = button("배터리 최적화 설정 열기");
        batteryButton.setOnClickListener(v -> {
            try {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception ignored) {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            }
        });
        root.addView(batteryButton);

        TextView disclosure = text(
                "수집 범위\n이 앱은 새로 도착한 문자 중 발신자 또는 본문에 ‘피클플러스’가 포함된 문자만 감지합니다. " +
                        "해당 문자의 발신자, 본문, 수신시각을 연결된 Funtastic SaaS로 전송하며 다른 문자는 읽거나 전송하지 않습니다. " +
                        "문자 접근 허용 버튼을 누르면 이 처리에 동의한 것으로 봅니다.",
                13,
                Color.DKGRAY
        );
        disclosure.setBackgroundColor(Color.rgb(243, 244, 246));
        disclosure.setPadding(dp(14), dp(14), dp(14), dp(14));
        root.addView(disclosure);

        TextView version = text("앱 버전 " + BuildConfig.VERSION_NAME, 12, Color.GRAY);
        version.setGravity(Gravity.CENTER);
        version.setPadding(0, dp(20), 0, 0);
        root.addView(version);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        return scroll;
    }

    private TextView statusBox() {
        TextView view = text("", 14, Color.DKGRAY);
        view.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(0, 0, 0, dp(10));
        view.setLayoutParams(params);
        view.setBackgroundColor(Color.rgb(249, 250, 251));
        return view;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52));
        params.setMargins(0, 0, 0, dp(10));
        button.setLayoutParams(params);
        return button;
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void refreshStatus() {
        boolean paired = BridgePreferences.isPaired(this);
        boolean permitted = checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
        connectionStatus.setText(paired ? "연결 상태: SaaS 연결됨" : "연결 상태: 연결 필요");
        connectionStatus.setTextColor(paired ? Color.rgb(4, 120, 87) : Color.rgb(180, 83, 9));
        permissionStatus.setText(permitted ? "문자 권한: 허용됨" : "문자 권한: 허용 필요");
        permissionStatus.setTextColor(permitted ? Color.rgb(4, 120, 87) : Color.rgb(180, 83, 9));
        permissionButton.setEnabled(!permitted);
        permissionButton.setText(permitted ? "문자 접근 허용됨" : "문자 접근 허용");
    }

    private void requestSmsPermissionWithConsent() {
        BridgePreferences.setConsent(this, true);
        requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, SMS_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == SMS_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (!granted) BridgePreferences.setConsent(this, false);
            Toast.makeText(this, granted ? "문자 수신이 활성화되었습니다." : "문자 권한이 필요합니다.", Toast.LENGTH_SHORT).show();
            refreshStatus();
        }
    }

    private void scanPairingQr() {
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(this);
        scanner.startScan()
                .addOnSuccessListener(barcode -> handlePairingUri(Uri.parse(barcode.getRawValue())))
                .addOnFailureListener(error -> Toast.makeText(this, "QR을 읽지 못했습니다: " + error.getMessage(), Toast.LENGTH_LONG).show());
    }

    private void handlePairingUri(Uri uri) {
        if (uri == null) return;
        if (!"funtastic-sms".equals(uri.getScheme()) || !"pair".equals(uri.getHost())) {
            Toast.makeText(this, "Funtastic 연결 QR이 아닙니다.", Toast.LENGTH_LONG).show();
            return;
        }
        String server = uri.getQueryParameter("server");
        String token = uri.getQueryParameter("token");
        if (server == null || token == null || !server.startsWith("https://")) {
            Toast.makeText(this, "연결 정보가 올바르지 않습니다.", Toast.LENGTH_LONG).show();
            return;
        }
        connectionStatus.setText("연결 상태: 연결 중...");
        new Thread(() -> pair(server, token)).start();
    }

    private void pair(String server, String token) {
        try {
            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("deviceName", Build.MANUFACTURER + " " + Build.MODEL);
            body.put("appVersion", BuildConfig.VERSION_NAME);
            JSONObject result = ApiClient.post(server + "/api/sms-bridge/pair", body, null);
            BridgePreferences.savePairing(this, server, result.getString("deviceId"), result.getString("deviceToken"));
            runOnUiThread(() -> {
                refreshStatus();
                Toast.makeText(this, "SaaS 연결이 완료되었습니다.", Toast.LENGTH_LONG).show();
            });
            sendHeartbeat();
        } catch (Exception error) {
            runOnUiThread(() -> {
                refreshStatus();
                Toast.makeText(this, "연결 실패: " + error.getMessage(), Toast.LENGTH_LONG).show();
            });
        }
    }

    private void sendHeartbeat() {
        if (!BridgePreferences.isPaired(this)) return;
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("appVersion", BuildConfig.VERSION_NAME);
                ApiClient.post(
                        BridgePreferences.server(this) + "/api/sms-bridge/heartbeat",
                        body,
                        BridgePreferences.token(this)
                );
            } catch (Exception ignored) {
                // The next app open or SMS upload refreshes the heartbeat.
            }
        }).start();
    }
}
