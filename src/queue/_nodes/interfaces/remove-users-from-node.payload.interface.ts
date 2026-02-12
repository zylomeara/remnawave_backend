import { RemoveUsersCommand } from '@zmrw/node-contract';

export interface IRemoveUsersFromNodePayload {
    data: RemoveUsersCommand.Request;
    node: {
        address: string;
        port: number | null;
    };
}
