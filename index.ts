import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

/**
 * Namespace
 * ----------
 * We isolate all resources for this challenge inside a dedicated namespace.
 * This avoids interfering with existing workloads in the OVH Kubernetes cluster
 * (such as ingress-nginx, cert-manager, and kube-system components).
 */
const ns = new k8s.core.v1.Namespace("pulumi-guestbook", {
    metadata: {
        name: "pulumi-guestbook",
    },
});

/**
 * ============================================================
 * REDIS MASTER
 * ============================================================
 *
 * Primary Redis instance used as the write database
 * for the Guestbook application.
 *
 * Redis 7 is used because:
 * - Stable and production-ready
 * - Official maintained image
 * - Avoids deprecated sample containers
 */

const redisMasterLabels = {
    app: "redis",
    role: "master",
    tier: "backend",
};

const redisMaster = new k8s.apps.v1.Deployment("redis-master", {
    metadata: {
        namespace: ns.metadata.name,
    },
    spec: {
        selector: {
            matchLabels: redisMasterLabels,
        },
        replicas: 1,
        template: {
            metadata: {
                labels: redisMasterLabels,
            },
            spec: {
                containers: [
                    {
                        name: "redis",
                        image: "redis:7",
                        ports: [
                            {
                                containerPort: 6379,
                            },
                        ],
                    },
                ],
            },
        },
    },
});

const redisMasterService = new k8s.core.v1.Service("redis-master", {
    metadata: {
        namespace: ns.metadata.name,
        name: "redis-master",
    },
    spec: {
        selector: redisMasterLabels,
        ports: [
            {
                port: 6379,
                targetPort: 6379,
            },
        ],
    },
});

/**
 * ============================================================
 * REDIS REPLICA
 * ============================================================
 *
 * Replica node connected to Redis master using
 * Kubernetes internal DNS resolution.
 */

const redisReplicaLabels = {
    app: "redis",
    role: "replica",
    tier: "backend",
};

const redisReplica = new k8s.apps.v1.Deployment("redis-replica", {
    metadata: {
        namespace: ns.metadata.name,
    },
    spec: {
        selector: {
            matchLabels: redisReplicaLabels,
        },
        replicas: 1,
        template: {
            metadata: {
                labels: redisReplicaLabels,
            },
            spec: {
                containers: [
                    {
                        name: "redis",
                        image: "redis:7",
                        args: [
                            "redis-server",
                            "--replicaof",
                            "redis-master",
                            "6379",
                        ],
                        ports: [
                            {
                                containerPort: 6379,
                            },
                        ],
                    },
                ],
            },
        },
    },
});

const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
    metadata: {
        namespace: ns.metadata.name,
        name: "redis-replica",
    },
    spec: {
        selector: redisReplicaLabels,
        ports: [
            {
                port: 6379,
                targetPort: 6379,
            },
        ],
    },
});

/**
 * ============================================================
 * FRONTEND CONFIGMAP
 * ============================================================
 *
 * Static HTML content mounted into nginx.
 * This replaces deprecated Google sample frontend images.
 */

const frontendHtml = new k8s.core.v1.ConfigMap("frontend-html", {
    metadata: {
        namespace: ns.metadata.name,
    },
    data: {
        "index.html": `
<!doctype html>
<html>
<head>
  <title>Guestbook</title>
</head>
<body>
  <h1>Guestbook (Pulumi + Kubernetes)</h1>
  <p>Running stable version on OVH Kubernetes cluster</p>
</body>
</html>
        `,
    },
});

/**
 * ============================================================
 * FRONTEND
 * ============================================================
 */

const frontendLabels = {
    app: "guestbook",
    tier: "frontend",
};

const frontend = new k8s.apps.v1.Deployment("frontend", {
    metadata: {
        namespace: ns.metadata.name,
    },
    spec: {
        selector: {
            matchLabels: frontendLabels,
        },
        replicas: 2,
        template: {
            metadata: {
                labels: frontendLabels,
            },
            spec: {
                containers: [
                    {
                        name: "nginx",
                        image: "nginx:stable",
                        ports: [
                            {
                                containerPort: 80,
                            },
                        ],
                        volumeMounts: [
                            {
                                name: "html",
                                mountPath: "/usr/share/nginx/html",
                            },
                        ],
                    },
                ],
                volumes: [
                    {
                        name: "html",
                        configMap: {
                            name: frontendHtml.metadata.name,
                        },
                    },
                ],
            },
        },
    },
});

const frontendService = new k8s.core.v1.Service("frontend", {
    metadata: {
        namespace: ns.metadata.name,
        name: "frontend",
    },
    spec: {
        type: "LoadBalancer",
        selector: frontendLabels,
        ports: [
            {
                port: 80,
                targetPort: 80,
            },
        ],
    },
});

/**
 * ============================================================
 * PROMETHEUS + GRAFANA STACK
 * ============================================================
 *
 * Deploys:
 * - Prometheus
 * - Grafana
 * - kube-state-metrics
 * - node-exporter
 * - Alertmanager
 *
 * Using kube-prometheus-stack Helm chart.
 */

const monitoring = new k8s.helm.v3.Release("monitoring", {
    name: "monitoring",
    namespace: ns.metadata.name,

    chart: "kube-prometheus-stack",

    version: "58.0.0",

    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },

    values: {
        grafana: {
            service: {
                type: "LoadBalancer",
            },

            adminPassword: "admin123",
        },

        prometheus: {
            service: {
                type: "ClusterIP",
            },
        },

        alertmanager: {
            enabled: true,
        },
    },
});

/**
 * ============================================================
 * REDIS EXPORTER
 * ============================================================
 *
 * Redis does not expose Prometheus metrics natively.
 * We use redis_exporter to expose Redis metrics
 * consumable by Prometheus.
 */

const redisExporterLabels = {
    app: "redis-exporter",
    tier: "monitoring",
};

const redisExporter = new k8s.apps.v1.Deployment("redis-exporter", {
    metadata: {
        namespace: ns.metadata.name,
    },
    spec: {
        selector: {
            matchLabels: redisExporterLabels,
        },

        replicas: 1,

        template: {
            metadata: {
                labels: redisExporterLabels,
            },

            spec: {
                containers: [
                    {
                        name: "redis-exporter",

                        image: "oliver006/redis_exporter:v1.55.0",

                        env: [
                            {
                                name: "REDIS_ADDR",
                                value: "redis://redis-master:6379",
                            },
                        ],

                        ports: [
                            {
                                containerPort: 9121,
                            },
                        ],
                    },
                ],
            },
        },
    },
});

const redisExporterService = new k8s.core.v1.Service("redis-exporter", {
    metadata: {
        namespace: ns.metadata.name,
        name: "redis-exporter",
        labels: {
            app: "redis-exporter",
        },
    },

    spec: {
        selector: redisExporterLabels,

        ports: [
            {
                port: 9121,
                targetPort: 9121,
                name: "metrics",
            },
        ],
    },
});

/**
 * ============================================================
 * REDIS SERVICEMONITOR
 * ============================================================
 *
 * Prometheus Operator uses ServiceMonitor resources
 * to discover scrape targets automatically.
 */

const redisServiceMonitor = new k8s.apiextensions.CustomResource("redis-sm", {
    apiVersion: "monitoring.coreos.com/v1",

    kind: "ServiceMonitor",

    metadata: {
        name: "redis-sm",

        namespace: ns.metadata.name,

        labels: {
            release: "monitoring",
        },
    },

    spec: {
        selector: {
            matchLabels: {
                app: "redis-exporter",
            },
        },

        endpoints: [
            {
                port: "metrics",
                interval: "15s",
            },
        ],
    },
});

/**
 * ============================================================
 * NGINX EXPORTER
 * ============================================================
 *
 * Exposes nginx metrics for Prometheus scraping.
 */

const nginxExporterLabels = {
    app: "nginx-exporter",
};

const nginxExporter = new k8s.apps.v1.Deployment("nginx-exporter", {
    metadata: {
        namespace: ns.metadata.name,
    },

    spec: {
        selector: {
            matchLabels: nginxExporterLabels,
        },

        replicas: 1,

        template: {
            metadata: {
                labels: nginxExporterLabels,
            },

            spec: {
                containers: [
                    {
                        name: "nginx-exporter",

                        image: "nginx/nginx-prometheus-exporter:1.1.0",

                        args: [
                            "-nginx.scrape-uri=http://frontend:80/",
                        ],

                        ports: [
                            {
                                containerPort: 9113,
                            },
                        ],
                    },
                ],
            },
        },
    },
});

const nginxExporterService = new k8s.core.v1.Service("nginx-exporter", {
    metadata: {
        namespace: ns.metadata.name,
        name: "nginx-exporter",
        labels: {
            app: "nginx-exporter",
        },
    },

    spec: {
        selector: nginxExporterLabels,

        ports: [
            {
                port: 9113,
                targetPort: 9113,
                name: "metrics",
            },
        ],
    },
});

/**
 * ============================================================
 * FRONTEND SERVICEMONITOR
 * ============================================================
 */

const frontendServiceMonitor = new k8s.apiextensions.CustomResource("frontend-sm", {
    apiVersion: "monitoring.coreos.com/v1",

    kind: "ServiceMonitor",

    metadata: {
        name: "frontend-sm",

        namespace: ns.metadata.name,

        labels: {
            release: "monitoring",
        },
    },

    spec: {
        selector: {
            matchLabels: {
                app: "nginx-exporter",
            },
        },

        endpoints: [
            {
                port: "metrics",
                interval: "15s",
            },
        ],
    },
});

/**
 * ============================================================
 * GRAFANA DASHBOARDS
 * ============================================================
 *
 * Grafana sidecar automatically discovers ConfigMaps
 * labeled with:
 *
 *   grafana_dashboard=1
 *
 * and imports dashboards automatically.
 *
 * This allows "dashboards as code" fully managed by Pulumi.
 */

/**
 * ------------------------------------------------------------
 * REDIS DASHBOARD
 * ------------------------------------------------------------
 *
 * Basic dashboard for Redis exporter metrics.
 */

const redisDashboard = new k8s.core.v1.ConfigMap("redis-dashboard", {
    metadata: {
        namespace: ns.metadata.name,

        labels: {
            grafana_dashboard: "1",
        },
    },

    data: {
        "redis-dashboard.json": JSON.stringify({
            annotations: {
                list: [],
            },

            editable: true,

            panels: [
                {
                    title: "Redis Connected Clients",

                    type: "timeseries",

                    datasource: {
                        type: "prometheus",
                        uid: "prometheus",
                    },

                    targets: [
                        {
                            expr: "redis_connected_clients",
                            refId: "A",
                        },
                    ],

                    gridPos: {
                        h: 8,
                        w: 12,
                        x: 0,
                        y: 0,
                    },
                },

                {
                    title: "Redis Memory Usage",

                    type: "timeseries",

                    datasource: {
                        type: "prometheus",
                        uid: "prometheus",
                    },

                    targets: [
                        {
                            expr: "redis_memory_used_bytes",
                            refId: "A",
                        },
                    ],

                    gridPos: {
                        h: 8,
                        w: 12,
                        x: 12,
                        y: 0,
                    },
                },
            ],

            schemaVersion: 38,

            style: "dark",

            tags: ["redis"],

            title: "Redis Monitoring",

            version: 1,
        }),
    },
});

/**
 * ------------------------------------------------------------
 * NGINX DASHBOARD
 * ------------------------------------------------------------
 *
 * Dashboard for frontend nginx exporter metrics.
 */

const nginxDashboard = new k8s.core.v1.ConfigMap("nginx-dashboard", {
    metadata: {
        namespace: ns.metadata.name,

        labels: {
            grafana_dashboard: "1",
        },
    },

    data: {
        "nginx-dashboard.json": JSON.stringify({
            annotations: {
                list: [],
            },

            editable: true,

            panels: [
                {
                    title: "NGINX Connections",

                    type: "timeseries",

                    datasource: {
                        type: "prometheus",
                        uid: "prometheus",
                    },

                    targets: [
                        {
                            expr: "nginx_connections_active",
                            refId: "A",
                        },
                    ],

                    gridPos: {
                        h: 8,
                        w: 12,
                        x: 0,
                        y: 0,
                    },
                },

                {
                    title: "NGINX HTTP Requests",

                    type: "timeseries",

                    datasource: {
                        type: "prometheus",
                        uid: "prometheus",
                    },

                    targets: [
                        {
                            expr: "rate(nginx_http_requests_total[1m])",
                            refId: "A",
                        },
                    ],

                    gridPos: {
                        h: 8,
                        w: 12,
                        x: 12,
                        y: 0,
                    },
                },
            ],

            schemaVersion: 38,

            style: "dark",

            tags: ["nginx"],

            title: "NGINX Frontend Monitoring",

            version: 1,
        }),
    },
});


/**
 * ============================================================
 * OUTPUTS
 * ============================================================
 */

/**
 * Guestbook public LoadBalancer IP
 */
export const frontendIP =
    frontendService.status.loadBalancer.ingress[0].ip;

/**
 * Guestbook public URL
 */
export const frontendURL =
    pulumi.interpolate`http://${frontendIP}`;

/**
 * Grafana service lookup
 * ----------------------
 * The Grafana LoadBalancer service is created automatically
 * by the kube-prometheus-stack Helm chart.
 *
 * We retrieve the generated Kubernetes Service resource
 * in order to export the external IP dynamically.
 */
const grafanaService = k8s.core.v1.Service.get(
    "grafana-service",
    pulumi.interpolate`${ns.metadata.name}/monitoring-grafana`,
);

/**
 * Grafana external LoadBalancer IP
 */
export const grafanaIP =
    grafanaService.status.loadBalancer.ingress[0].ip;

/**
 * Grafana public URL
 */
export const grafanaURL =
    pulumi.interpolate`http://${grafanaIP}`;

/**
 * Grafana default admin credentials
 *
 * NOTE:
 * Hardcoded credentials are acceptable only for demo/lab
 * environments. Production systems should use Kubernetes
 * Secrets or external secret managers.
 */
export const grafanaAdminUser = "admin";
export const grafanaAdminPassword = "admin123";