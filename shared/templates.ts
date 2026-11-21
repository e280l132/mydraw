// Starter diagrams for apply_template. Icons are stencil names or "Collection:search" queries;
// when the user's library has no match the node falls back to a plain shape (with a warning), so
// every template works with any set of icon packs.
import type { DiagramSpec } from "./diagram";

export interface Template {
  name: string;
  title: string;
  description: string;
  spec: DiagramSpec;
}

export const TEMPLATES: readonly Template[] = [
  {
    name: "three-tier-web",
    title: "3-tier web app",
    description: "Users, load balancer, web and app tiers, primary/replica database. Vendor-neutral shapes.",
    spec: {
      direction: "right",
      zones: [
        { id: "web", label: "Web tier" },
        { id: "app", label: "App tier" },
        { id: "data", label: "Data tier" },
      ],
      nodes: [
        { id: "users", label: "Users", shape: "ellipse", kind: "Client" },
        { id: "lb", label: "Load balancer", shape: "diamond", kind: "Load balancer" },
        { id: "web1", label: "web-1", zone: "web", kind: "Server" },
        { id: "web2", label: "web-2", zone: "web", kind: "Server" },
        { id: "app1", label: "app-1", zone: "app", kind: "Server" },
        { id: "app2", label: "app-2", zone: "app", kind: "Server" },
        { id: "db1", label: "DB primary", shape: "ellipse", zone: "data", kind: "Database" },
        { id: "db2", label: "DB replica", shape: "ellipse", zone: "data", kind: "Database" },
      ],
      edges: [
        { from: "users", to: "lb", label: "HTTPS" },
        { from: "lb", to: "web1" },
        { from: "lb", to: "web2" },
        { from: "web1", to: "app1" },
        { from: "web2", to: "app2" },
        { from: "app1", to: "db1" },
        { from: "app2", to: "db1" },
        { from: "db1", to: "db2", label: "replication", style: "dashed", kind: "Replication" },
      ],
    },
  },
  {
    name: "aws-vpc",
    title: "AWS VPC (2 AZs)",
    description: "Route 53, internet gateway, ALB, EC2 in private subnets across two AZs, Multi-AZ RDS, NAT gateway.",
    spec: {
      direction: "right",
      zones: [
        { id: "aws", label: "AWS Cloud", color: "#232f3e", fill: "#ffffff" },
        { id: "vpc", label: "VPC 10.0.0.0/16", parent: "aws", color: "#8c4fff", fill: "#ffffff" },
        { id: "pubA", label: "Public subnet A", parent: "vpc", color: "#7aa116", fill: "#f2f6e8" },
        { id: "pubB", label: "Public subnet B", parent: "vpc", color: "#7aa116", fill: "#f2f6e8" },
        { id: "privA", label: "Private subnet A", parent: "vpc", color: "#00a4a6", fill: "#e6f6f7" },
        { id: "privB", label: "Private subnet B", parent: "vpc", color: "#00a4a6", fill: "#e6f6f7" },
      ],
      nodes: [
        { id: "users", label: "Users", icon: "AWS:Users" },
        { id: "dns", label: "Route 53", icon: "AWS:Amazon Route 53", zone: "aws" },
        { id: "igw", label: "Internet gateway", icon: "AWS:Amazon VPC Internet Gateway", zone: "vpc" },
        { id: "alb", label: "ALB", icon: "AWS:Elastic Load Balancing", zone: "pubA" },
        { id: "nat", label: "NAT gateway", icon: "AWS:Amazon VPC NAT Gateway", zone: "pubB" },
        { id: "ec2a", label: "app-a", icon: "AWS:Amazon EC2", zone: "privA" },
        { id: "ec2b", label: "app-b", icon: "AWS:Amazon EC2", zone: "privB" },
        { id: "rdsA", label: "RDS primary", icon: "AWS:Amazon RDS", zone: "privA" },
        { id: "rdsB", label: "RDS standby", icon: "AWS:Amazon RDS", zone: "privB" },
      ],
      edges: [
        { from: "users", to: "dns", label: "DNS" },
        { from: "users", to: "igw", label: "HTTPS" },
        { from: "igw", to: "alb" },
        { from: "alb", to: "ec2a" },
        { from: "alb", to: "ec2b" },
        { from: "ec2a", to: "rdsA", label: "SQL" },
        { from: "ec2b", to: "rdsA", label: "SQL" },
        { from: "rdsA", to: "rdsB", label: "sync", style: "dashed", kind: "Replication" },
        { from: "ec2b", to: "nat", style: "dotted", label: "egress", kind: "Outbound" },
      ],
      legend: true,
    },
  },
  {
    name: "gcp-project",
    title: "Google Cloud project",
    description: "HTTPS load balancer, Cloud Run services, Pub/Sub, Cloud SQL and Cloud Storage in one project.",
    spec: {
      direction: "right",
      zones: [
        { id: "project", label: "GCP project", color: "#4285f4" },
        { id: "region", label: "us-central1", parent: "project", color: "#34a853" },
      ],
      nodes: [
        { id: "users", label: "Users", shape: "ellipse" },
        { id: "lb", label: "Cloud Load Balancing", icon: "Google Cloud:Cloud Load Balancing", zone: "project" },
        { id: "api", label: "api (Cloud Run)", icon: "Google Cloud:Cloud Run", zone: "region" },
        { id: "worker", label: "worker (Cloud Run)", icon: "Google Cloud:Cloud Run", zone: "region" },
        { id: "pubsub", label: "Pub/Sub", icon: "Google Cloud:Pub/Sub", zone: "region" },
        { id: "sql", label: "Cloud SQL", icon: "Google Cloud:Cloud SQL", zone: "region" },
        { id: "gcs", label: "Cloud Storage", icon: "Google Cloud:Cloud Storage", zone: "project" },
      ],
      edges: [
        { from: "users", to: "lb", label: "HTTPS" },
        { from: "lb", to: "api" },
        { from: "api", to: "sql" },
        { from: "api", to: "pubsub", label: "publish" },
        { from: "pubsub", to: "worker", label: "push" },
        { from: "worker", to: "gcs" },
      ],
    },
  },
  {
    name: "home-network",
    title: "Home network",
    description: "ISP modem, router/firewall, switch with wired devices, Wi-Fi access point with wireless clients.",
    spec: {
      direction: "down",
      zones: [
        { id: "lan", label: "LAN 192.168.1.0/24", color: "#1971c2" },
        { id: "wired", label: "Wired", parent: "lan", color: "#2f9e44" },
        { id: "wifi", label: "Wi-Fi", parent: "lan", color: "#e8590c" },
      ],
      nodes: [
        { id: "internet", label: "Internet", icon: "Network:cloud", shape: "ellipse" },
        { id: "modem", label: "ISP modem", icon: "Network:modem" },
        { id: "router", label: "Router / firewall", icon: "Network:router", zone: "lan" },
        { id: "switch", label: "Switch", icon: "Network:switch", zone: "lan" },
        { id: "nas", label: "NAS", icon: "Network:storage", zone: "wired" },
        { id: "server", label: "Server", icon: "Network:server", zone: "wired" },
        { id: "desktop", label: "Desktop", icon: "Network:desktop", zone: "wired" },
        { id: "ap", label: "Wi-Fi AP", icon: "Network:wireless", zone: "wifi" },
        { id: "laptop", label: "Laptop", icon: "Network:laptop", zone: "wifi" },
        { id: "phone", label: "Phone", icon: "Network:mobile", zone: "wifi" },
      ],
      edges: [
        { from: "internet", to: "modem", arrow: "none" },
        { from: "modem", to: "router", arrow: "none" },
        { from: "router", to: "switch", arrow: "none" },
        { from: "switch", to: "nas", arrow: "none" },
        { from: "switch", to: "server", arrow: "none" },
        { from: "switch", to: "desktop", arrow: "none" },
        { from: "switch", to: "ap", arrow: "none" },
        { from: "ap", to: "laptop", arrow: "none", style: "dashed", kind: "Wireless" },
        { from: "ap", to: "phone", arrow: "none", style: "dashed", kind: "Wireless" },
      ],
      legend: true,
    },
  },
  {
    name: "k8s-cluster",
    title: "Kubernetes cluster",
    description: "Ingress, service, deployment with three pods, config map, secret and persistent volume claim.",
    spec: {
      direction: "right",
      zones: [
        { id: "cluster", label: "Cluster", color: "#326ce5" },
        { id: "ns", label: "namespace: app", parent: "cluster", color: "#326ce5", style: "dashed" },
      ],
      nodes: [
        { id: "users", label: "Users", shape: "ellipse" },
        { id: "ing", label: "Ingress", icon: "Kubernetes:ing", zone: "ns" },
        { id: "svc", label: "Service", icon: "Kubernetes:svc", zone: "ns" },
        { id: "deploy", label: "Deployment", icon: "Kubernetes:deploy", zone: "ns" },
        { id: "pod1", label: "pod-1", icon: "Kubernetes:pod", zone: "ns" },
        { id: "pod2", label: "pod-2", icon: "Kubernetes:pod", zone: "ns" },
        { id: "pod3", label: "pod-3", icon: "Kubernetes:pod", zone: "ns" },
        { id: "cm", label: "ConfigMap", icon: "Kubernetes:cm", zone: "ns" },
        { id: "secret", label: "Secret", icon: "Kubernetes:secret", zone: "ns" },
        { id: "pvc", label: "PVC", icon: "Kubernetes:pvc", zone: "ns" },
      ],
      edges: [
        { from: "users", to: "ing", label: "HTTPS" },
        { from: "ing", to: "svc" },
        { from: "svc", to: "pod1" },
        { from: "svc", to: "pod2" },
        { from: "svc", to: "pod3" },
        { from: "deploy", to: "pod1", style: "dashed", kind: "Manages" },
        { from: "deploy", to: "pod2", style: "dashed", kind: "Manages" },
        { from: "deploy", to: "pod3", style: "dashed", kind: "Manages" },
        { from: "pod1", to: "cm", style: "dotted", kind: "Mounts" },
        { from: "pod1", to: "secret", style: "dotted", kind: "Mounts" },
        { from: "pod1", to: "pvc", style: "dotted", kind: "Mounts" },
      ],
    },
  },
  {
    name: "homelab-rack",
    title: "Homelab",
    description: "Router, switch, Proxmox host with VMs and LXC containers, Docker host with containers, NAS.",
    spec: {
      direction: "down",
      zones: [
        { id: "rack", label: "Rack", color: "#495057" },
        { id: "pve", label: "Proxmox host", parent: "rack", color: "#e8590c" },
        { id: "docker", label: "Docker host (LXC)", parent: "pve", color: "#1971c2" },
      ],
      nodes: [
        { id: "internet", label: "Internet", shape: "ellipse" },
        { id: "router", label: "Router", icon: "Network:router", zone: "rack" },
        { id: "switch", label: "Switch", icon: "Network:switch", zone: "rack" },
        { id: "nas", label: "NAS", icon: "Network:storage", zone: "rack" },
        { id: "vm1", label: "VM: Home Assistant", zone: "pve", kind: "VM" },
        { id: "vm2", label: "VM: Windows", zone: "pve", kind: "VM" },
        { id: "c1", label: "Portainer", zone: "docker", kind: "Container" },
        { id: "c2", label: "Homepage", zone: "docker", kind: "Container" },
        { id: "c3", label: "Reverse proxy", zone: "docker", kind: "Container" },
      ],
      edges: [
        { from: "internet", to: "router", arrow: "none" },
        { from: "router", to: "switch", arrow: "none" },
        { from: "switch", to: "pve", arrow: "none" },
        { from: "switch", to: "nas", arrow: "none" },
        { from: "c3", to: "c2" },
        { from: "c3", to: "vm1" },
        { from: "pve", to: "nas", label: "backups", style: "dashed", kind: "Backup" },
      ],
    },
  },
];

export function findTemplate(name: string): Template | undefined {
  const n = name.trim().toLowerCase();
  return TEMPLATES.find((t) => t.name === n || t.title.toLowerCase() === n);
}
