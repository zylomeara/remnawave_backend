import { AddUserCommand as AddUserToNodeCommandSdk } from '@zmrw/node-contract';

export interface IAddUserToNodePayload {
    data: AddUserToNodeCommandSdk.Request;
    node: {
        address: string;
        port: number | null;
    };
}
