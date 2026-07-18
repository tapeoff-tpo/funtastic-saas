import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const require = createRequire(
  path.join(home, ".local/share/funtastic/bambu-printer-mcp/package.json"),
);
const mqtt = require("mqtt");
const configPath = path.join(home, ".config/funtastic/bambu.env");
const outputPath = process.argv[2] || path.join("build", "doctor", "printer-report.json");

function readEnv(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const splitAt = line.indexOf("=");
        return [line.slice(0, splitAt), line.slice(splitAt + 1)];
      }),
  );
}

function loadedSlots(ams) {
  const units = Array.isArray(ams?.ams) ? ams.ams : [];
  return units.flatMap((unit) =>
    (Array.isArray(unit?.tray) ? unit.tray : [])
      .filter((tray) => tray?.tray_type || tray?.tray_info_idx)
      .map((tray) => ({
        ams_id: unit.id,
        slot_id: tray.id,
        material: tray.tray_type || "unknown",
        color: tray.tray_color || "unknown",
        remaining_percent: tray.remain ?? null,
      })),
  );
}

const env = readEnv(configPath);
const token = execFileSync(
  "security",
  ["find-generic-password", "-s", "FUN-TASTIC Bambu P2S", "-a", process.env.USER, "-w"],
  { encoding: "utf8" },
).trim();

const client = mqtt.connect(`mqtts://${env.BAMBU_PRINTER_HOST}:8883`, {
  username: "bblp",
  password: token,
  rejectUnauthorized: false,
  connectTimeout: 5000,
  reconnectPeriod: 0,
});

const snapshot = {};
let firmware = null;
let connected = false;
let connectionError = null;

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 10000);
    client.on("connect", () => {
      connected = true;
      client.subscribe(`device/${env.BAMBU_PRINTER_SERIAL}/report`, (error) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        const sequenceId = String(Date.now());
        client.publish(
          `device/${env.BAMBU_PRINTER_SERIAL}/request`,
          JSON.stringify({ pushing: { command: "pushall", sequence_id: sequenceId } }),
        );
        client.publish(
          `device/${env.BAMBU_PRINTER_SERIAL}/request`,
          JSON.stringify({ info: { command: "get_version", sequence_id: sequenceId } }),
        );
      });
    });
    client.on("message", (_topic, payload) => {
      try {
        const message = JSON.parse(payload.toString());
        if (message.print && typeof message.print === "object") {
          Object.assign(snapshot, message.print);
        }
        if (Array.isArray(message.info?.module)) {
          firmware = message.info.module;
        }
        if (snapshot.gcode_state && firmware) {
          clearTimeout(timer);
          setTimeout(resolve, 500);
        }
      } catch {
        // Ignore unrelated messages on the device report topic.
      }
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
} catch (error) {
  connected = false;
  connectionError = error.message;
}

client.end(true);
const ota = firmware?.find((module) => module.name === "ota");
const report = {
  timestamp: new Date().toISOString(),
  transport: "LAN MQTT read-only",
  connected,
  connection_error: connectionError,
  printer: {
    model: env.BAMBU_MODEL || "P2S",
    serial_suffix: env.BAMBU_PRINTER_SERIAL?.slice(-4) || "unknown",
    firmware: ota?.sw_ver || "unknown",
    state: snapshot.gcode_state || "unknown",
    nozzle_actual_c: snapshot.nozzle_temper ?? null,
    nozzle_target_c: snapshot.nozzle_target_temper ?? null,
    bed_actual_c: snapshot.bed_temper ?? null,
    bed_target_c: snapshot.bed_target_temper ?? null,
    layer_current: snapshot.layer_num ?? null,
    layer_total: snapshot.total_layer_num ?? null,
  },
  ams: {
    detected: Boolean(snapshot.ams),
    loaded_slots: loadedSlots(snapshot.ams),
  },
  camera: {
    checked: false,
    reason: "Fallback probe is deliberately limited to MQTT status reads.",
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`P2S ${connected ? "CONNECTED" : "FAILED"}`);
console.log(`  State: ${report.printer.state}`);
console.log(`  Firmware: ${report.printer.firmware}`);
console.log(`  Nozzle/bed: ${report.printer.nozzle_actual_c} C / ${report.printer.bed_actual_c} C`);
console.log(`  AMS slots loaded: ${report.ams.loaded_slots.length}`);
console.log(`  Report: ${outputPath}`);
process.exitCode = connected ? 0 : 1;
