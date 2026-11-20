import { QrService } from './qr.service';

describe('QrService', () => {
  const link = 'https://picplease.app/s/3428da7f-d9f8-48a5-879b-971b2e1c3a54#' + 'a'.repeat(43);
  const qr = new QrService();

  it('renders the link as a PNG and as SVG', async () => {
    const png = await qr.renderPng(link);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.readUInt32BE(16)).toBe(512); // IHDR width
    expect(await qr.renderSvg(link)).toMatch(/^<svg/);
  });
});
