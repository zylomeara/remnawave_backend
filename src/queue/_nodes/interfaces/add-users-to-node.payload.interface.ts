import { AddUsersCommand as AddUsersToNodeCommandSdk } from '@zmrw/node-contract';

export interface IAddUsersToNodePayload {
    data: AddUsersToNodeCommandSdk.Request;
    node: {
        address: string;
        port: number | null;
    };
}
