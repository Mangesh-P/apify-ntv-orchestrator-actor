import { Actor, log, KeyValueStore } from 'apify';
import archiver from 'archiver';
import { PassThrough } from 'stream';

const { ACTOR_DEFAULT_KEY_VALUE_STORE_ID } = process.env;

export async function getZip(keyValueStore: KeyValueStore, maxFileInZip: number) {
    let fileCount = 0;
    let archiveIndex = 0;

    let archive = archiver('zip');

    let output = new PassThrough() as PassThrough;
    archive.pipe(output);

    setArchiveTimeout(archive, 5 * 60 * 1000); // 5 minutes

    log.info(`Starting to zip files in ${keyValueStore.name}`);
    await keyValueStore.forEachKey(async (key: string, index: number, info: any) => {
        if (shouldSkipKey(key)) {
            log.info(`${index} : ${key} Skipped`);
            return;
        }

        const file = await keyValueStore.getValue(key) as Buffer | null;
        if (file !== null) {
            if (maxFileInZip !== 0 && fileCount >= maxFileInZip) {
                await finalizeArchive(archive);
                await createZipOutput(output, archiveIndex);
                archiveIndex += 1;

                archive = archiver('zip');
                output = new PassThrough();
                archive.pipe(output);
                fileCount = 0; // reset file count
            }

            const filePath = `${key}.jpeg`;
            log.info(`${index} : ${filePath}`, { size: `${(info.size / (1024 * 1024)).toFixed(3)} MB` });

            handleArchiveEvents(archive);

            archive.append(
                file as Buffer,
                { name: filePath },
            );
            fileCount += 1;
        }
    });

    if (archiveIndex === 0) {
        await finalizeArchive(archive);
        await createZipOutput(output, archiveIndex);
    }

    log.info(`ZipCount Saved: ${archiveIndex}`);
    await Actor.pushData({ zipCount: archiveIndex });
}

async function createZipOutput(output: any, archiveIndex: number = 0) {
    const buffer: any[] = [];
    for await (const chunk of output) {
        buffer.push(chunk);
    }

    const zippedBuffer = Buffer.concat(buffer);
    if (logZipFileSize(zippedBuffer)) {
        const outputFilename = `screenshots${archiveIndex}.zip`;
        log.info(`Output filename: ${outputFilename} `);

        await Actor.setValue(outputFilename, zippedBuffer, {
            contentType: `application / zip`,
        });

        const zipUrl = `https://api.apify.com/v2/key-value-stores/${ACTOR_DEFAULT_KEY_VALUE_STORE_ID}/records/${outputFilename}?disableRedirect=true`;
        log.info(`Screenshot saved: ${zipUrl}`);

        await Actor.pushData({ zipUrl });
        log.info('screenshot zip url saved in default dataset');
    } else {
        throw new Error('Zip file size is less than 0 MB');
    }
}

function setArchiveTimeout(archive: archiver.Archiver, timeout: number) {
    setTimeout(() => {
        log.error('Zipping process timed out after 5 minutes');
        archive.abort();
        throw new Error('Zipping process timed out after 5 minutes');
    }, timeout);
}

function shouldSkipKey(key: string) {
    return key === 'INPUT' || key === 'actor-state' || key === 'screenshots.zip';
}

async function finalizeArchive(archive: archiver.Archiver) {
    await archive.finalize();
}

function handleArchiveEvents(archive: archiver.Archiver) {
    // good practice to catch this error explicitly
    archive.on('error', (err: any) => {
        throw err;
    });

    archive.on('finish', () => {
        log.info('Finalized zip file');
    });
}

function logZipFileSize(buffer: Buffer) {
    const zippedSizeInBytes = buffer.byteLength;
    const zippedSizeInMB = zippedSizeInBytes / (1024 * 1024);
    log.info(`Zip file size: ${zippedSizeInMB.toFixed(3)} MB`);
    return !(zippedSizeInMB < 1);
}
