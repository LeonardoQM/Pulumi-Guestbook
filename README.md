# Pulumi-Guestbook
This exercise implements a full Kubernetes-based Guestbook application deployed with Pulumi, including a Redis backend, an NGINX frontend, and a complete observability stack.

⚠️ Prerequisite: Pulumi installation

This project assumes that Pulumi is already installed and configured on the local machine.

If Pulumi is not installed, it must be installed following the official instructions for the specific operating system being used (e.g., Ubuntu, macOS, or Windows).

Installation guides are available here:

`https://www.pulumi.com/docs/install/`

Ensure that the following are available before proceeding:

pulumi CLI available in PATH

Authenticated session via pulumi login

A working Kubernetes context configured (kubectl access to the cluster)


🚀 1. Deploy Instructions

1.1 Create project directory

'mkdir pulumi-guestbook-monitoring
cd pulumi-guestbook-monitoring'

All infrastructure code will live inside this folder. All resources are deployed into a single isolated Kubernetes namespace:
pulumi-guestbook

1.2 Initialize Pulumi project

pulumi login
pulumi new kubernetes-typescript

When prompted:
    • Project name: pulumi-guestbook-monitoring 
    • Stack name: dev 

1.3 Replace Pulumi program
Replace the generated index.ts with the provided implementation.
⚠️ This file contains the full stack:
    • Guestbook application 
    • Redis master/replica 
    • Prometheus + Grafana monitoring stack 
    • Exporters (Redis + NGINX) 
    • ServiceMonitors 
    • Grafana dashboards (as code) 

1.4 Install dependencies

npm install

Note: this step may already be handled by pulumi new.

1.5 Deploy infrastructure

pulumi up

Confirm the deployment:
yes

After executing `pulumi up`, Pulumi will display the generated infrastructure outputs defined in the `OUTPUTS` section of the program.

These outputs include dynamically assigned values such as:

- Guestbook frontend external IP and URL
- Grafana external IP and URL
- Grafana admin credentials

These values can be used to access and validate the deployed services after the infrastructure provisioning completes.

1.6 Verify deployment

kubectl get pods -n pulumi-guestbook
kubectl get svc -n pulumi-guestbook



🌐 2. Application Access
Guestbook Frontend

Pulumi output:
frontendURL

Or manually:

kubectl get svc -n pulumi-guestbook frontend

Open in browser:
http://<EXTERNAL-IP>

Grafana Access
Pulumi outputs:
    • Grafana URL 
    • Admin credentials 
URL
http://<GRAFANA-EXTERNAL-IP>
Credentials
Username: admin
Password: admin123

📈 3. Prometheus Metrics Verification
Step 1 — Check ServiceMonitors exist
kubectl get servicemonitor -n pulumi-guestbook
Expected:
    • redis-sm 
    • frontend-sm 

Step 2 — Verify Prometheus targets
Open Prometheus UI:
http://<PROMETHEUS-SERVICE>
Then go to:
Status → Targets
You should see:
    • redis-exporter (UP) 
    • nginx-exporter (UP) 
    • node-exporter (UP) 
    • kube-state-metrics (UP) 

    

Step 3 — Validate metrics manually
Redis metrics
kubectl port-forward svc/redis-exporter 9121:9121 -n pulumi-guestbook

curl http://localhost:9121/metrics
Look for:
    • redis_connected_clients 
    • redis_memory_used_bytes 

NGINX metrics
kubectl port-forward svc/nginx-exporter 9113:9113 -n pulumi-guestbook

curl http://localhost:9113/metrics
Look for:
    • nginx_http_requests_total 
    • nginx_connections_active 

Step 4 — Verify Grafana dashboards
In Grafana:
Dashboards → Browse
You should see:
    • Redis Monitoring 
    • NGINX Frontend Monitoring 
These are automatically provisioned via Kubernetes ConfigMaps:
labels:
  grafana_dashboard: "1"

  

📊 4. Architecture Summary
Frontend (nginx)
    ↓
Redis Master / Replica
Metrics layer:
    Redis Exporter → Prometheus
    NGINX Exporter → Prometheus
Observability:
    Prometheus → Grafana Dashboards

⚠️ Notes
    • This setup is lab/demo grade 
    • Grafana password is hardcoded intentionally for simplicity 
    • In production: 
        ◦ Use Kubernetes Secrets 
        ◦ Restrict LoadBalancer exposure 
        ◦ Add authentication / ingress



📌 5. Assumptions

The following assumptions were made during the design and implementation of this solution:

a. Modern and compatible versions
All Kubernetes components and dependencies are assumed to be using modern, stable, and compatible versions.
This includes:
    • Kubernetes API versions supported by the cluster 
    • redis:7 official image 
    • nginx:stable image 
    • kube-prometheus-stack Helm chart (modern release compatible with Prometheus Operator CRDs) 
    • Exporters (redis-exporter, nginx-prometheus-exporter) using recent stable tags 
The goal is to avoid deprecated APIs and ensure long-term maintainability.

b. Host operating system
The development and deployment environment is assumed to be:
    • Ubuntu Linux (local development machine) 
This affects:
    • CLI tooling compatibility (Pulumi, kubectl, Node.js) 
    • Shell scripting and commands used in deployment instructions 
No Windows-specific or Mac-specific steps are included.

c. Kubernetes environment
The solution is designed and validated for:
    • OVH Cloud Managed Kubernetes Service 
Assumptions about the cluster:
    • LoadBalancer services are supported and provision external IPs automatically 
    • Prometheus Operator CRDs are available via Helm installation 
    • DNS-based service discovery is enabled inside the cluster 
    • Standard RBAC permissions allow deployment of: 
        ◦ Deployments 
        ◦ Services 
        ◦ ConfigMaps 
        ◦ Custom Resources (ServiceMonitor) 

d. Observability stack behavior
It is assumed that:
    • Grafana sidecar provisioning is enabled by default in kube-prometheus-stack 
    • ServiceMonitor resources are automatically detected by Prometheus Operator 
    • Default Prometheus scrape configuration is active unless overridden 

e. Security scope (lab environment)
This deployment is intended for:
    • Development / learning / evaluation purposes 
Therefore:
    • Grafana admin password is hardcoded (admin123) 
    • No TLS / ingress authentication is configured 
    • Services are exposed via LoadBalancer without additional network restrictions



🧯 6. Troubleshooting

This Pulumi code was rigorously tested in a real K8s cluster , but if...

- Pods not starting / CrashLoopBackOff
Check pod status:
kubectl get pods -n pulumi-guestbook
Inspect logs:
kubectl logs <pod-name> -n pulumi-guestbook
Common causes:
    • Missing ConfigMap (frontend HTML) 
    • Image pull delays (first deployment) 
    • Service DNS resolution issues (Redis replica → master) 

- Grafana not accessible
Check service status:
kubectl get svc -n pulumi-guestbook monitoring-grafana
If EXTERNAL-IP is <pending>:
    • The cloud LoadBalancer is still provisioning 
    • Wait 1–3 minutes (specific Cloud behavior) 
Verify pod is running:
kubectl get pods -n pulumi-guestbook -l app.kubernetes.io/name=grafana

- Prometheus not scraping targets
Check ServiceMonitors:
kubectl get servicemonitor -n pulumi-guestbook
Expected:
    • redis-sm 
    • frontend-sm 
Check Prometheus targets:
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090 -n pulumi-guestbook
Then open:
http://localhost:9090/targets
Look for:
    • UP (green) = healthy scrape 
    • DOWN = exporter or ServiceMonitor issue 

- No metrics for Redis or NGINX
Check exporters:
kubectl get pods -n pulumi-guestbook | grep exporter
Validate endpoints manually:
kubectl port-forward svc/redis-exporter 9121:9121 -n pulumi-guestbook
curl http://localhost:9121/metrics
kubectl port-forward svc/nginx-exporter 9113:9113 -n pulumi-guestbook
curl http://localhost:9113/metrics
If empty:
    • exporter cannot reach target service (DNS issue) 
    • wrong REDIS_ADDR or scrape URI 

- Grafana dashboards not appearing
Check if dashboards are provisioned:
kubectl get configmap -n pulumi-guestbook | grep dashboard
Expected:
    • redis-dashboard 
    • nginx-dashboard 
If missing:
    • Grafana sidecar is not detecting ConfigMaps 
    • Ensure label is present: 
grafana_dashboard: "1"

- Kubernetes resources inconsistent after update
Pulumi drift or failed update:
pulumi refresh
pulumi preview
Then re-apply:
pulumi up

