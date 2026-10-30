import { UAParser } from "ua-parser-js";
import { open, type CityResponse } from "maxmind";
import { referrerWebsite } from "../domain/referrer";
let geolocation: ReturnType<typeof open<CityResponse>> | undefined;
export async function visitorContext(
  request: Request,
  referrer?: string | null,
) {
  const ip = request.headers.get("x-wavecase-ip") || null;
  const agent = UAParser(request.headers.get("user-agent") || "");
  let geo: CityResponse | null = null;
  if (ip && process.env.GEOIP_DATABASE) {
    try {
      geolocation ||= open<CityResponse>(process.env.GEOIP_DATABASE);
      geo = (await geolocation).get(ip);
    } catch {
      geolocation = undefined;
    }
  }
  return {
    ip,
    browser: agent.browser.name || null,
    browserVersion: agent.browser.version || null,
    osVersion: agent.os.version || null,
    deviceModel: agent.device.model || null,
    os: agent.os.name || null,
    device: agent.device.type || (agent.os.name ? "desktop" : null),
    country: geo?.country?.iso_code || null,
    city: geo?.city?.names?.en || null,
    referrer: referrerWebsite(referrer, new URL(request.url).origin),
  };
}
