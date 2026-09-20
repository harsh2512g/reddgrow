export function pdfFixture(text: string, encrypted = false) {
  // Minimal one-page PDF generated in memory, with accurate offsets and no external assets.
  const escaped = text.replace(/[()\\]/g, '\\$&');
  const stream = `BT /F1 12 Tf 50 700 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  if (encrypted)
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -4 >>`,
    );
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => {
    offsets.push(result.length);
    result += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = result.length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n ')
    .join(
      '\n',
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt 6 0 R /ID [<${'01'.repeat(16)}><${'01'.repeat(16)}>]` : ''} >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(result);
}
