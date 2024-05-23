export interface ITargetActorRunOptions {
    token: string;
    build: string;
}
export interface IInput {
    parallelRunsCount: number;
    targetActorRunOptions: ITargetActorRunOptions;
    adID: string;
    isBulkIFUScreenshots: boolean;
    userID: number;
    placementsInfo: ILookupPlacement[];
    maxFileInZip: number;
}

export interface IState {
    parallelRunIds: string[];
    placementsInfo: ILookupPlacement[];
    runningTasks: any[];
}

export interface ILookupPlacement {
    placementID: number;
    url: string;
    adID: string;
}
