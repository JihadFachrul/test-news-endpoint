import { describe, expect, it } from 'vitest';
import { emptyToNull, htmlToText } from '../src/normalize/text.js';
import { parseEngagement } from '../src/normalize/numbers.js';

describe('membersihkan HTML', () => {
  it('membuang tag pembungkus dan menerjemahkan &nbsp;', () => {
    expect(
      htmlToText(
        '<p>The ringgit opened higher against the greenback on Monday, buoyed by&nbsp;improved sentiment.</p>',
      ),
    ).toBe('The ringgit opened higher against the greenback on Monday, buoyed by improved sentiment.');
  });

  it('menerjemahkan &quot; menjadi tanda kutip', () => {
    expect(htmlToText('<p>citing &quot;balanced&quot; risks to inflation.</p>')).toBe(
      'citing "balanced" risks to inflation.',
    );
  });

  it('membuang tag script BESERTA isinya', () => {
    // Record nst-40130 di data asli menyelipkan kode berbahaya.
    // Kode itu tidak boleh sampai ke halaman dashboard.
    const hasil = htmlToText(
      '<p>Several roads in Shah Alam were impassable.</p><script>alert(1)</script>',
    );
    expect(hasil).toBe('Several roads in Shah Alam were impassable.');
    expect(hasil).not.toContain('alert');
  });

  it('membuang kode berbahaya yang bersembunyi di balik entity HTML', () => {
    // Ini alasan tag dibuang DUA KALI: teks ini masih jinak saat datang, tapi
    // berubah jadi tag hidup setelah entity-nya diterjemahkan.
    expect(htmlToText('aman &lt;script&gt;alert(1)&lt;/script&gt; teks')).toBe('aman teks');
  });

  it('batas paragraf jadi spasi supaya kata tidak menempel', () => {
    expect(htmlToText('<p>satu</p><p>dua</p>')).toBe('satu dua');
  });

  it('tulisan biasa yang memakai tanda < dan > tidak ikut terhapus', () => {
    expect(htmlToText('pertumbuhan 5 < 10 persen')).toBe('pertumbuhan 5 < 10 persen');
  });

  it('teks biasa dan nilai kosong tetap aman', () => {
    expect(htmlToText('The ringgit opened higher.')).toBe('The ringgit opened higher.');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
  });
});

describe('menyeragamkan nilai kosong', () => {
  it('null, teks kosong, dan spasi diperlakukan sama', () => {
    // Data feed memakai null untuk judul tweet, tapi "" untuk judul Facebook.
    expect(emptyToNull(null)).toBeNull();
    expect(emptyToNull('')).toBeNull();
    expect(emptyToNull('   ')).toBeNull();
    expect(emptyToNull('  Bank Negara  holds  ')).toBe('Bank Negara holds');
  });
});

describe('membaca angka engagement', () => {
  it('teks berkoma ribuan jadi bilangan', () => {
    expect(parseEngagement('1,204')).toBe(1204);
    expect(parseEngagement('3,402')).toBe(3402);
  });

  it('angka biasa diteruskan apa adanya', () => {
    expect(parseEngagement(412)).toBe(412);
    expect(parseEngagement(0)).toBe(0);
  });

  it('lebih baik kosong daripada angka yang salah', () => {
    expect(parseEngagement(null)).toBeNull();
    expect(parseEngagement('banyak')).toBeNull();
    expect(parseEngagement(-5)).toBeNull();
  });
});
