import { Injectable } from '@nestjs/common';
import { toBuffer, toString } from 'qrcode';

const OPTIONS = { errorCorrectionLevel: 'M', margin: 2 } as const;

/** Renders session links as QR codes. */
@Injectable()
export class QrService {
  /** A PNG, 512 px wide. */
  renderPng(link: string): Promise<Buffer> {
    return toBuffer(link, { ...OPTIONS, type: 'png', width: 512 });
  }

  renderSvg(link: string): Promise<string> {
    return toString(link, { ...OPTIONS, type: 'svg' });
  }
}
