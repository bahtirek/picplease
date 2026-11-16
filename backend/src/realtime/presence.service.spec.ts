import { PresenceService } from './presence.service';
import { isAllowedWsOrigin } from './realtime-ws.adapter';

describe('PresenceService', () => {
  it('isRequesterOnline only while a requester socket is connected', () => {
    const presence = new PresenceService();
    expect(presence.isRequesterOnline('s1')).toBe(false);
    presence.markConnected('s1', 'requester');
    presence.markConnected('s1', 'requester');
    expect(presence.isRequesterOnline('s1')).toBe(true);
    expect(presence.isRequesterOnline('s2')).toBe(false);
    presence.markDisconnected('s1', 'requester');
    expect(presence.isRequesterOnline('s1')).toBe(true);
    presence.markDisconnected('s1', 'requester');
    expect(presence.isRequesterOnline('s1')).toBe(false);
  });

  it('a helper never makes the requester online', () => {
    const presence = new PresenceService();
    presence.markConnected('s1', 'helper');
    expect(presence.isRequesterOnline('s1')).toBe(false);
    presence.markDisconnected('s1', 'helper');
    presence.markDisconnected('s1', 'requester');
    expect(presence.isRequesterOnline('s1')).toBe(false);
  });
});

describe('isAllowedWsOrigin', () => {
  it('allows WEB_ORIGIN and native clients only', () => {
    const web = 'https://picplease.app';
    expect(isAllowedWsOrigin(web, web)).toBe(true);
    expect(isAllowedWsOrigin(undefined, web)).toBe(true);
    expect(isAllowedWsOrigin('https://evil.example', web)).toBe(false);
    expect(isAllowedWsOrigin('http://picplease.app', web)).toBe(false);
  });
});
