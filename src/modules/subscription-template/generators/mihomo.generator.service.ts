import yaml from 'yaml';
import _ from 'lodash';

import { Injectable, Logger } from '@nestjs/common';

import { SubscriptionTemplateService } from '@modules/subscription-template/subscription-template.service';

import { IFormattedHost } from './interfaces/formatted-hosts.interface';

export interface ClashData {
    proxies: ProxyNode[];
    rules: string[];
}

interface NetworkConfig {
    'early-data-header-name'?: string;
    'grpc-service-name'?: string;
    headers?: Record<string, string>;
    Host?: string;
    host?: string[];
    'max-early-data'?: number;
    path?: string | string[];
    smux?: {
        [key: string]: any;
        enabled: boolean;
    };
    'v2ray-http-upgrade'?: boolean;
    'v2ray-http-upgrade-fast-open'?: boolean;
    'public-key'?: string;
    'short-id'?: string;
}

interface ProxyNode {
    [key: string]: any;
    alpn?: string[];
    alterId?: number;
    cipher?: string;
    name: string;
    network?: string;
    password?: string;
    port: number;
    server: string;
    servername?: string;
    'skip-cert-verify'?: boolean;
    'packet-encoding'?: string;
    sni?: string;
    tls?: boolean;
    type: string;
    udp: boolean;
    uuid?: string;
    serverDescription?: string;
}

@Injectable()
export class MihomoGeneratorService {
    private readonly logger = new Logger(MihomoGeneratorService.name);

    constructor(private readonly subscriptionTemplateService: SubscriptionTemplateService) {}

    async generateConfig(
        hosts: IFormattedHost[],
        isStash: boolean = false,
        isFlClashX = false,
        overrideTemplateName?: string,
    ): Promise<string> {
        try {
            const data: ClashData = {
                proxies: [],
                rules: [],
            };
            const proxyRemarks: string[] = [];

            for (const host of hosts) {
                if (!host) {
                    continue;
                }
                this.addProxy(host, data, proxyRemarks, isFlClashX);
            }

            return await this.renderConfig(data, proxyRemarks, isStash, overrideTemplateName);
        } catch (error) {
            this.logger.error('Error generating clash config:', error);
            return '';
        }
    }

    private async renderConfig(
        data: ClashData,
        proxyRemarks: string[],
        isStash: boolean,
        overrideTemplateName?: string,
    ): Promise<string> {
        const yamlConfigDb = await this.subscriptionTemplateService.getCachedTemplateByType(
            isStash ? 'STASH' : 'MIHOMO',
            overrideTemplateName,
        );

        try {
            const yamlConfig = yamlConfigDb as unknown as any;

            if (!Array.isArray(yamlConfig.proxies)) {
                yamlConfig.proxies = [];
            }

            if (!Array.isArray(yamlConfig['proxy-groups'])) {
                yamlConfig['proxy-groups'] = [];
            }

            for (const group of yamlConfig['proxy-groups']) {
                if (!Array.isArray(group.proxies)) {
                    group.proxies = [];
                }
            }

            const proxyTypeMap = new Map<string, string>();

            for (const proxy of data.proxies) {
                yamlConfig.proxies.push(proxy);
                proxyTypeMap.set(proxy.name, proxy.type);
            }

            for (const group of yamlConfig['proxy-groups']) {
                let remnawaveCustom = undefined;

                if (group?.remnawave) {
                    remnawaveCustom = group.remnawave;

                    delete group.remnawave;
                }

                if (remnawaveCustom && remnawaveCustom['include-proxies'] === false) {
                    continue;
                }

                let filteredRemarks = proxyRemarks;

                if (remnawaveCustom && remnawaveCustom['filter']) {
                    const filterRegex = new RegExp(remnawaveCustom['filter']);
                    filteredRemarks = filteredRemarks.filter((r) => filterRegex.test(r));
                }

                if (remnawaveCustom && remnawaveCustom['exclude-filter']) {
                    const excludeRegex = new RegExp(remnawaveCustom['exclude-filter']);
                    filteredRemarks = filteredRemarks.filter((r) => !excludeRegex.test(r));
                }

                if (remnawaveCustom && Array.isArray(remnawaveCustom['include-type'])) {
                    const includeTypes: string[] = remnawaveCustom['include-type'];
                    filteredRemarks = filteredRemarks.filter((r) =>
                        includeTypes.includes(proxyTypeMap.get(r) || ''),
                    );
                }

                if (remnawaveCustom && Array.isArray(remnawaveCustom['exclude-type'])) {
                    const excludeTypes: string[] = remnawaveCustom['exclude-type'];
                    filteredRemarks = filteredRemarks.filter(
                        (r) => !excludeTypes.includes(proxyTypeMap.get(r) || ''),
                    );
                }

                if (remnawaveCustom && remnawaveCustom['shuffle-proxies-order'] === true) {
                    filteredRemarks = _.shuffle(filteredRemarks);
                }

                if (remnawaveCustom && remnawaveCustom['pin-proxies']) {
                    const pinConfig = remnawaveCustom['pin-proxies'];
                    const pinKeys = Object.keys(pinConfig);

                    filteredRemarks = [...filteredRemarks].sort((a, b) => {
                        for (const key of pinKeys) {
                            let aPriority: number;
                            let bPriority: number;

                            if (key === 'by-name') {
                                const patterns = pinConfig['by-name'].map(
                                    (p: string) => new RegExp(p),
                                );
                                const aIdx = patterns.findIndex((p: RegExp) => p.test(a));
                                const bIdx = patterns.findIndex((p: RegExp) => p.test(b));
                                aPriority = aIdx === -1 ? patterns.length : aIdx;
                                bPriority = bIdx === -1 ? patterns.length : bIdx;
                            } else if (key === 'by-protocol') {
                                const typeOrder: string[] = pinConfig['by-protocol'];
                                const aType = proxyTypeMap.get(a) || '';
                                const bType = proxyTypeMap.get(b) || '';
                                const aIdx = typeOrder.indexOf(aType);
                                const bIdx = typeOrder.indexOf(bType);
                                aPriority = aIdx === -1 ? typeOrder.length : aIdx;
                                bPriority = bIdx === -1 ? typeOrder.length : bIdx;
                            } else {
                                continue;
                            }

                            if (aPriority !== bPriority) {
                                return aPriority - bPriority;
                            }
                        }
                        return 0;
                    });
                }

                if (remnawaveCustom && remnawaveCustom['select-random-proxy'] === true) {
                    const randomProxy =
                        filteredRemarks[Math.floor(Math.random() * filteredRemarks.length)];

                    if (randomProxy) {
                        group.proxies.push(randomProxy);
                    }

                    continue;
                }

                if (Array.isArray(group.proxies)) {
                    for (const proxyRemark of filteredRemarks) {
                        group.proxies.push(proxyRemark);
                    }
                }
            }

            if (yamlConfig['proxy-providers']) {
                // dialer-proxy support
                for (const providerKey in yamlConfig['proxy-providers']) {
                    const provider = yamlConfig['proxy-providers'][providerKey];

                    let remnawaveCustom = undefined;

                    if (provider?.remnawave) {
                        remnawaveCustom = provider.remnawave;

                        delete provider.remnawave;
                    } else {
                        continue;
                    }

                    if (remnawaveCustom && remnawaveCustom['include-proxies'] === true) {
                        provider.payload = [];

                        for (const proxy of data.proxies) {
                            provider.payload.push(proxy);
                        }
                    }
                }
            }

            return yaml.stringify(yamlConfig);
        } catch (error) {
            this.logger.error(`Error rendering yaml config: ${error}`);
            return '';
        }
    }

    private addProxy(
        host: IFormattedHost,
        data: ClashData,
        proxyRemarks: string[],
        isFlClashX: boolean,
    ): void {
        if (host.network === 'xhttp') {
            return;
        }

        const proxyRemark = host.remark;

        if (host.protocol === 'hysteria2') {
            const node = this.makeHysteria2Node(host);

            if (host.serverDescription && isFlClashX) {
                node.serverDescription = Buffer.from(host.serverDescription, 'base64').toString();
            }

            data.proxies.push(node);
            proxyRemarks.push(proxyRemark);
            return;
        }

        const node = this.makeNode({
            name: host.remark,
            remark: proxyRemark,
            type: host.protocol,
            server: host.address,
            port: Number(host.port),
            network: host.network || 'tcp',
            tls: ['reality', 'tls'].includes(host.tls),
            sni: host.sni || '',
            host: host.host,
            path: host.path || '',
            headers: '',
            udp: true,
            alpn: host.alpn,
            publicKey: host.publicKey,
            shortId: host.shortId,
            clientFingerprint: host.fingerprint,
            allowInsecure: host.allowInsecure,
            mihomoX25519: host.mihomoX25519,
        });

        switch (host.protocol) {
            case 'vless':
                node.uuid = host.password.vlessPassword;
                node['packet-encoding'] = 'xudp';

                if (host.flow === 'xtls-rprx-vision') {
                    node.flow = host.flow;
                }

                if (host.encryption && host.encryption !== 'none') {
                    node.encryption = host.encryption;
                }

                break;
            case 'trojan':
                node.password = host.password.trojanPassword;
                break;
            case 'shadowsocks':
                node.password = host.password.ssPassword;
                node.cipher = 'chacha20-ietf-poly1305';
                break;
            default:
                return;
        }

        if (host.serverDescription && isFlClashX) {
            // supported in FlClashX, custom field
            node.serverDescription = Buffer.from(host.serverDescription, 'base64').toString();
        }

        data.proxies.push(node);
        proxyRemarks.push(proxyRemark);
    }

    private makeNode(params: {
        name: string;
        remark: string;
        type: string;
        server: string;
        port: number;
        network: string;
        tls: boolean;
        sni: string;
        host: string;
        path: string;
        headers: string;
        udp: boolean;
        alpn?: string;
        publicKey?: string;
        shortId?: string;
        clientFingerprint?: string;
        allowInsecure?: boolean;
        mihomoX25519?: boolean;
    }): ProxyNode {
        const {
            server,
            port,
            remark,
            tls,
            sni,
            alpn,
            udp,
            host,
            path,
            headers,
            publicKey,
            shortId,
            clientFingerprint,
            allowInsecure,
            mihomoX25519,
        } = params;
        let { type, network } = params;

        if (type === 'shadowsocks') {
            type = 'ss';
        }
        if ((network === 'tcp' || network === 'raw') && headers === 'http') {
            network = 'http';
        }

        let isHttpupgrade = false;
        if (network === 'httpupgrade') {
            network = 'ws';
            isHttpupgrade = true;
        }

        const node: ProxyNode = {
            name: remark,
            type,
            server,
            port,
            network,
            udp,
        };

        let maxEarlyData: number | undefined;
        let earlyDataHeaderName = '';

        let pathValue = path;

        if (path.includes('?ed=')) {
            const [pathPart, edPart] = path.split('?ed=');
            pathValue = pathPart;
            maxEarlyData = parseInt(edPart.split('/')[0]);
            earlyDataHeaderName = 'Sec-WebSocket-Protocol';
        }

        if (tls) {
            node.tls = true;
            if (type === 'trojan') {
                node.sni = sni;
            } else {
                node.servername = sni;
            }
            if (alpn) {
                node.alpn = alpn.split(',');
            }
        }

        let netOpts: NetworkConfig = {};

        switch (network) {
            case 'ws':
                netOpts = this.wsConfig(
                    pathValue,
                    host,
                    maxEarlyData,
                    earlyDataHeaderName,
                    isHttpupgrade,
                );
                break;
            case 'tcp':
            case 'raw':
                netOpts = this.tcpConfig(pathValue, host);
                break;
            case 'grpc':
                netOpts = this.grpcConfig(pathValue);
                break;
        }

        if (Object.keys(netOpts).length > 0) {
            node[`${network}-opts`] = netOpts;
        }

        if (publicKey) {
            node['reality-opts'] = {
                'public-key': publicKey,
                'short-id': shortId,
            };

            if (mihomoX25519) {
                node['reality-opts']['support-x25519mlkem768'] = true;
            }
        }

        if (allowInsecure && type !== 'ss') {
            node['skip-cert-verify'] = allowInsecure;
        }

        node['client-fingerprint'] = clientFingerprint || 'chrome';

        return node;
    }

    private wsConfig(
        path = '',
        host = '',
        maxEarlyData?: number,
        earlyDataHeaderName = '',
        isHttpupgrade = false,
    ): NetworkConfig {
        const config: NetworkConfig = {};

        if (path) {
            config.path = path;
        }

        if (host) {
            config.headers = { Host: host };
        } else {
            config.headers = {};
        }

        if (maxEarlyData !== undefined) {
            config['max-early-data'] = maxEarlyData;
        }

        if (earlyDataHeaderName) {
            config['early-data-header-name'] = earlyDataHeaderName;
        }

        if (isHttpupgrade) {
            config['v2ray-http-upgrade'] = true;
            config['v2ray-http-upgrade-fast-open'] = true;
        }

        return config;
    }

    private tcpConfig(path = '', host = ''): NetworkConfig {
        const config: NetworkConfig = {};

        if (!path && !host) {
            return config;
        }

        return config;
    }

    private grpcConfig(path = ''): NetworkConfig {
        const config: NetworkConfig = {};

        config['grpc-service-name'] = path;

        return config;
    }

    private makeHysteria2Node(host: IFormattedHost): ProxyNode {
        const node: ProxyNode = {
            name: host.remark,
            type: 'hysteria2',
            server: host.address,
            port: Number(host.port),
            password: host.password.trojanPassword,
            udp: true,
        };

        if (host.sni) {
            node.sni = host.sni;
        }

        node['client-fingerprint'] = host.fingerprint || 'chrome';

        if (host.alpn) {
            node.alpn = host.alpn.split(',');
        } else {
            node.alpn = ['h3'];
        }

        if (host.allowInsecure) {
            node['skip-cert-verify'] = host.allowInsecure;
        }

        // Salamander obfs (Clash/Mihomo format), matching the server's finalmask.
        if (host.obfsType && host.obfsPassword) {
            node.obfs = host.obfsType;
            node['obfs-password'] = host.obfsPassword;
        }

        // Fake-SNI: Mihomo has no verify-by-name, so pin the server cert by its
        // SHA-256 (sni already carries the fake domain). The connection stays
        // secure while DPI sees the masquerade SNI.
        if (host.pinnedPeerCertSha256) {
            node.fingerprint = host.pinnedPeerCertSha256;
        }

        return node;
    }
}
