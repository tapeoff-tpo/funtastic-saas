# Platform Interface V0 - Slice Report

Status: `ready-for-user-print-approval`

## Profile

- Printer profile: Bambu Lab P2S
- Plate: textured plate
- Material: Generic PLA
- Nozzle: 0.4 mm
- Layer height: 0.20 mm
- Wall loops: 2
- Sparse infill: 15%
- Support: disabled
- Plate objects: six disconnected physical bodies in one combined plate mesh

## Result

- Bambu Studio CLI: success
- Total layers: 44
- Model printing time: 2 h 14 m 24 s
- Total estimated time: 2 h 14 m 44 s
- Estimated filament: 28,304.27 mm / 68,079.75 mm3 / 84.42 g
- 3MF: `3mf/interface-test-plate.3mf`
- G-code: `build/slice/plate_1.gcode`
- Slicer warning requiring manual follow-up: unsupported channel-roof quality

## Printer State

The environment Doctor passed Blender, Bambu Studio, Blender MCP, Bambu MCP P2S
support, mesh dependencies, ffmpeg, configuration, and Keychain checks.

The configured P2S was unreachable during the 2026-07-18 read-only MQTT probe
(`connack timeout`). Firmware, AMS, temperatures, and camera therefore could not
be confirmed in this run. The printer must be powered, awake, and reachable at
its current LAN address before transfer.

No file was uploaded and no print was started.
