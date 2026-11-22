// One-off: a clean slate for the old audio folder question-audios/ (the audio
// library lives in audios/library/ since 2026-11-22; dev/... for a development
// server, see S3_PREFIX). It
//   1. takes the audio off every question using an Audio whose file is under
//      (dev/)question-audios/ (audio and trailing audio set to none),
//   2. deletes those Audio rows,
//   3. deletes every file under (dev/)question-audios/, with or without a row.
// Audio in audios/library/ is not touched.
//
// Without --confirm it only reports what it would do.
//
//   local:   npx tsx src/scripts/clearQuestionAudios.ts [--confirm]
//   Heroku:  heroku run -a p2p-voice-chat node dist/src/scripts/clearQuestionAudios.js [--confirm]

import UploadToS3, { S3_PREFIX } from '../controllers/upload_to_s3.js';
import { prisma } from '../prisma.js';

const PREFIX = `${S3_PREFIX}question-audios/`;
const confirm = process.argv.includes('--confirm');

const audios = await prisma.audio.findMany({
    where: { s3Key: { startsWith: PREFIX } },
    select: { id: true },
});
const ids = audios.map((a) => a.id);
const usingAudio = await prisma.questionItem.findMany({
    where: { OR: [{ audioId: { in: ids } }, { trailingAudioId: { in: ids } }] },
    select: { id: true, format: true },
});
const keys = await UploadToS3.listKeys(PREFIX);

console.log(`Folder: ${PREFIX}`);
console.log(`  Audio rows to delete:            ${ids.length}`);
console.log(`  Questions losing their audio:    ${usingAudio.length}` +
    (usingAudio.length ? ` (ids ${usingAudio.map((q) => q.id).join(', ')})` : ''));
const format9 = usingAudio.filter((q) => q.format === 9).map((q) => q.id);
if (format9.length) console.log(`  ...of which format 9 (needs an audio again): ${format9.join(', ')}`);
console.log(`  Files to delete:                 ${keys.length}`);

if (!confirm) {
    console.log('\nNothing changed. Run again with --confirm to do it.');
} else {
    await prisma.$transaction([
        prisma.questionItem.updateMany({ where: { audioId: { in: ids } }, data: { audioId: null } }),
        prisma.questionItem.updateMany({ where: { trailingAudioId: { in: ids } }, data: { trailingAudioId: null } }),
        prisma.audio.deleteMany({ where: { id: { in: ids } } }),
    ]);
    await UploadToS3.deleteKeys(keys);
    const left = await UploadToS3.listKeys(PREFIX);
    console.log(`\nDone. Files left under ${PREFIX}: ${left.length}`);
}
await prisma.$disconnect();
