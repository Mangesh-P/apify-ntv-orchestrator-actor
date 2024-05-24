import { Actor, ActorRun, log } from 'apify';
import lookupPlacementJson from './lookup-placements.json' assert { type: 'json' };
import { TARGET_CLP_ACTOR_ID, TARGET_LIGHTBOX_ACTOR_ID } from './constants.js';
import { getZip } from './zip.util.js';
import { saveError } from './utils.js';
import { IInput, ILookupPlacement, IState, ITargetActorRunOptions } from './interface.js';

await Actor.init();

const {
    parallelRunsCount,
    targetActorRunOptions = {} as ITargetActorRunOptions,
    adID,
    isBulkIFUScreenshots = false,
    userID,
    placementsInfo = [] as ILookupPlacement[],
    maxFileInZip = 0,
    zipIt = false,
} = await Actor.getInput<IInput>() ?? {} as IInput;
const { apifyClient } = Actor;

// Get the current run request queue and dataset, we use the default ones.
const dataset = await Actor.openDataset();
const keyValueStore = await Actor.openKeyValueStore();
log.info('Store ID:', { storeId: keyValueStore.id });
log.info('Starting run', { parallelRunsCount, isBulkIFUScreenshots, placementsInfoCount: placementsInfo.length });

const state = await Actor.useState<IState>('actor-state', { parallelRunIds: [], placementsInfo: [], runningTasks: [] });

try {
    await startToFinish();
    if (zipIt) {
        await getZip(keyValueStore, maxFileInZip);
    }
} catch (error: any) {
    await saveError(error);
    await Actor.fail('Execution failed!');
} finally {
    await Actor.exit('Execution finished!');
}

async function startToFinish() {
    // Abort parallel runs if the main run is aborted
    Actor.on('aborting', async () => {
        log.info('Aborting parallel runs');
        for (const runId of state.parallelRunIds) {
            log.info('Aborting run', { runId });
            await apifyClient.run(runId).abort();
        }
    });

    if (isBulkIFUScreenshots) {
        const finalPlacements = lookupPlacementJson.map((x) => {
            return {
                ...x,
                adID,
            } as ILookupPlacement;
        }) as ILookupPlacement[];

        await loopActorRun(finalPlacements, true);
    } else {
        await loopActorRun(placementsInfo, false);
    }
    log.info('All parallel runs finished');
}

async function loopActorRun(placements: ILookupPlacement[], isBulk: boolean) {
    state.placementsInfo = placements;
    log.info('Starting parallel runs', { parallelRunsCount });

    // Start initial tasks
    for (let i = 0; i < parallelRunsCount && state.placementsInfo.length > 0; i++) {
        const placement = state.placementsInfo.shift() as ILookupPlacement;
        state.runningTasks.push(startActorRun(placement, isBulk));
    }

    while (state.runningTasks.length > 0) {
        const taskIndex = await Promise.race(state.runningTasks.map((task, index) => task.then(() => index)));
        state.runningTasks[taskIndex].then(async (taskInfo: any) => {
            log.info(`Task finished with ID :`, { id: taskInfo.id });
        });
        state.runningTasks.splice(taskIndex, 1);

        if (state.placementsInfo.length > 0) {
            const placement = state.placementsInfo.shift() as ILookupPlacement;
            state.runningTasks.push(startActorRun(placement, isBulk));
        }
    }
}

async function startActorRun(placement: ILookupPlacement, isIFU: boolean): Promise<ActorRun> {
    let run: Promise<ActorRun> | null = null;

    if (placement.type === 'lightbox') {
        const temp = {
            isIFU,
            userID,
            placementInfo: {
                ...placement,
            },
        };
        run = Actor.start(TARGET_LIGHTBOX_ACTOR_ID, {
            ...temp,
            datasetId: dataset.id,
            keyValueStoreId: keyValueStore.id,
        }, targetActorRunOptions);
    } else if (placement.type === 'clp') {
        const temp = {
            userID,
            placementInfo: {
                ...placement,
            },
        };
        run = Actor.start(TARGET_CLP_ACTOR_ID, {
            ...temp,
            datasetId: dataset.id,
            keyValueStoreId: keyValueStore.id,
        }, targetActorRunOptions);
    }

    if (run !== null) {
        const runResult = await run;

        log.info(`Started parallel run with ID: ${runResult.id}`, { build: runResult.options.build });

        state.parallelRunIds.push(runResult.id);

        const runClient = apifyClient.run(runResult.id);
        return runClient.waitForFinish();
    }
    throw new Error('Invalid placement type. Should be either lightbox or clp.');
}
