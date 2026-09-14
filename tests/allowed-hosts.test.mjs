import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRequestHosts } from '../scripts/server/allowed-hosts.mjs';

const interfaces = { lan: [{family:'IPv4',address:'192.168.1.10'}], vpn: [{family:'IPv4',address:'100.100.1.2'}] };
test('wildcard bind accepts this machine addresses without allowing arbitrary Host values', () => {
  const hosts = allowedRequestHosts({host:'0.0.0.0',port:8018},interfaces,'WIKI-PC');
  for (const host of ['127.0.0.1','localhost','192.168.1.10','100.100.1.2','wiki-pc']) assert.ok(hosts.includes(`${host}:8018`));
  for (const host of ['attacker.example:8018','192.168.1.20:8018','192.168.1.10:3131','0.0.0.0:8018']) assert.ok(!hosts.includes(host));
});
test('loopback bind retains loopback Host restrictions', () => {
  assert.deepEqual(allowedRequestHosts({host:'127.0.0.1',port:8018},interfaces,'WIKI-PC'), ['127.0.0.1:8018','localhost:8018']);
});
