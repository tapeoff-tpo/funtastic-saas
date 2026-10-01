export const CHINA_OUTBOUND_DESTINATIONS = ['인천', '평택', '부산'] as const

export type ChinaOutboundDestination = (typeof CHINA_OUTBOUND_DESTINATIONS)[number]
