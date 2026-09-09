import { networkInterfaces, hostname } from 'node:os';

export function allowedRequestHosts(config, interfaces = networkInterfaces(), name = hostname()) {
  const names = new Set(['127.0.0.1', 'localhost']);
  if (config.host === '0.0.0.0' || config.host === '::') {
    names.add(name.toLowerCase());
    for (const addresses of Object.values(interfaces)) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4') names.add(address.address);
      }
    }
  } else if (config.host) names.add(config.host.toLowerCase());
  return [...names].map(host => `${host.includes(':') ? `[${host}]` : host}:${config.port}`);
}
