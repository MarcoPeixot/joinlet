// Examples from the Eraser DSL reference (eraserlabs/eraser-io, MIT):
// skills/eraser-diagrams/references/{architecture,flowchart}-syntax.md

export const ERASER_EXAMPLES: Record<string, string> = {
  'arch: Nodes': `compute [icon: aws-ec2]
`,
  'arch: Groups': `  Main Server {
    Server [icon: aws-ec2]
    Data [icon: aws-rds]
  }
`,
  'arch: Groups 2': `VPC Subnet {
  Main Server {
    Server [icon: aws-ec2]
    Data [icon: aws-rds]
  }
}
`,
  'arch: Properties': `  Main Server [icon: aws-ec2, color: blue] {
    Server [icon: aws-ec2]
    Data [icon: aws-rds]
  }
`,
  'arch: Properties 2': `// Names need to be distinct, but labels can overlap
Server_A [label: server]
Server_B [label: server]
`,
  'arch: Properties 3': `Server [icon: server, typeface: mono]
`,
  'arch: Connections': `Compute > Storage
`,
  'arch: Connections 2': `Storage > Server: Cache Hit
`,
  'arch: Connections 3': `Server > Worker1, Worker2, Worker3
`,
  'arch: Escape string': `User > "https://localhost:8080": GET
`,
  'arch: Direction': `direction down
`,
  'arch: AWS Diagram': `// Define groups and nodes
API gateway [icon: aws-api-gateway]
Lambda [icon: aws-lambda]
S3 [icon: aws-simple-storage-service]
VPC Subnet {
  Main Server {
    Server [icon: aws-ec2]
    Data [icon: aws-rds]
  }
  Queue [icon: aws-auto-scaling]
  Compute Nodes {
    Worker1 [icon: aws-ec2]
    Worker2 [icon: aws-ec2]
    Worker3 [icon: aws-ec2]
  }
}
Analytics [icon: aws-redshift]

// Define connections
API gateway > Lambda > Server > Data
Server > Queue
Queue > Worker1, Worker2, Worker3
S3 < Data
Compute Nodes > Analytics
`,
  'arch: Google Cloud Diagram': `// Define groups and nodes
Stream [icon: kafka, color: grey]
Ingest {
  Pub/Sub [icon: gcp-pubsub]
  Logging [icon: gcp-cloud-logging]
}
Pipelines {
  Dataflow [icon: gcp-dataflow]
}
Storage [icon: gcp-cloud-storage] {
  Datastore [icon: gcp-datastore]
  Bigtable [icon: gcp-bigtable]
}
Analytics {
  BigQuery [icon: gcp-bigquery]
}
Application [icon: gcp-app-engine] {
  App Engine [icon: gcp-app-engine]
  Container Engine [icon: gcp-container-registry]
  Compute Engine [icon: gcp-compute-engine]
}

// Define connections
Stream > Ingest
Logging > Analytics > Application
Pub/Sub > Pipelines > Storage > Application
`,
  'arch: Azure Diagram': `// Define groups and nodes
AD tenant [icon: azure-active-directory]
Load Balancers [icon: azure-load-balancers]
Virtual Network [icon: azure-virtual-networks] {
  Web Tier [icon: azure-network-security-groups] {
    vm1 [icon: azure-virtual-machine]
    vm2 [icon: azure-virtual-machine]
    vm3 [icon: azure-virtual-machine]
  }
  Business Tier [icon: azure-network-security-groups] {
    lb2 [icon: azure-load-balancers]
    vm4 [icon: azure-virtual-machine]
    vm5 [icon: azure-virtual-machine]
    vm6 [icon: azure-virtual-machine]
  }
}

// Define connections
AD tenant > Load Balancers
Load Balancers > vm1, vm2, vm3
vm1, vm2, vm3 > lb2 > vm4, vm5, vm6
`,
  'arch: Kubernetes Diagram': `// Define groups and nodes
Cloud Provider API [icon: settings]
AWS [icon: aws]
GCP [icon: google-cloud]
Azure [icon: azure]
Control Plane [icon: k8s-control-plane]{
  api [icon: k8s-api]
  sched [icon: k8s-sched]
  ccm [icon: k8s-c-c-m]
  cm [icon: k8s-c-m]
  etcd [icon: k8s-etcd]
}
Node1 [icon: k8s-node] {
  kubelet1 [icon: k8s-kubelet]
  kproxy1 [icon: k8s-k-proxy]
}
Node2 [icon: k8s-node] {
  kubelet2 [icon: k8s-kubelet]
  kproxy2 [icon: k8s-k-proxy]
}
Node3 [icon: k8s-node] {
  kubelet3 [icon: k8s-kubelet]
  kproxy3 [icon: k8s-k-proxy]
}

// Define connections
ccm > Cloud Provider API
Cloud Provider API > AWS, Azure, GCP
api > ccm, sched, etcd, cm
kubelet1, kproxy1, kubelet2, kproxy2, kubelet3, kproxy3 > api
`,
  'arch: Data ETL Pipeline': `// Define groups and nodes
Input data sources {
  Oracle [icon: oracle]
  Twitter [icon: twitter]
  Facebook [icon: facebook]
}
ETL pipeline [color: silver]{
  User survey data [icon: kafka]
  Data load [icon: aws-s3]
  Data transformation [icon: databricks]
  Data store [icon: snowflake]
}
Data destinations {
  Notification [icon: slack]
  Experimentation [icon: tensorflow]
  BI dashboard [icon: tableau]
}

// Define connections
Oracle, Twitter, Facebook > User survey data
User survey data > Data load > Data transformation > Data store
Data store > Notification, Experimentation, BI dashboard
`,
  'flow: Nodes': `Start [shape: oval]
`,
  'flow: Groups': `Loop {
  Issue1, Issue2, Issue3
}
`,
  'flow: Groups 2': `Loop {
  Issue1
  Issue2
  Issue3
}
`,
  'flow: Groups 3': `Outer Loop {
	Inner Loop {
		Issue1
		Issue2    
	}
	Issue3
}
`,
  'flow: Properties': `// Names need to be distinct, but labels can overlap
Start_A [label: start]
Start_B [label: start]
`,
  'flow: Properties 2': `Start [shape: oval, icon: flag]
`,
  'flow: Connections': `Issue > Bug
`,
  'flow: Connection label': `Issue > Bug: Triage
`,
  'flow: Branching connections': `Issue > Bug, Feature
`,
  'flow: Chained connections': `Issue > Bug > Duplicate?
`,
  'flow: Escape string': `User > "https://localhost:8080": GET
`,
  'flow: Direction': `direction right
`,
  'flow: Issue Triage Flow': `// Nodes and groups
Issue type? [shape: oval, icon: file-text]

BugPath [color: red] {
  Bug [icon: bug, color: red]
  Duplicate? [shape: diamond, icon: copy]
  Mark duplicate [shape: oval, icon: copy]
  Has repro? [shape: diamond, icon: repeat]
  Ask for repro [shape: oval, icon: repeat]
}

FeaturePath [color: green] {
  Feature [icon: zap, color: green]
  Well specced? [shape: diamond, icon: check-square]
  Can be package? [shape: diamond, icon: package]
  Define as package [shape: oval, icon: package]
}

Issue ready to claim [shape: oval, icon: send]

// Relationships
Issue type? > Bug
Bug > Duplicate?
Duplicate? > Mark duplicate: Yes
Duplicate? > Has repro?: No
Has repro? > Issue ready to claim: Yes
Has repro? > Ask for repro: No
Issue type? > Feature
Feature > Can be package?
Can be package? > Well specced?: No
Can be package? > Define as package: Yes
Well specced? > Issue ready to claim: Yes
`,
  'flow: Price Lookup Flow': `// Define nodes and relationships "A > B"
Start [shape: oval, icon: flag] > Read keywords from Excel [icon: excel]
Read keywords from Excel > Establish Amazon API connection [icon: amazon]
Establish Amazon API connection > Wait for user input [shape: diamond, icon: user]
Wait for user input > Search for keyword on Amazon[icon: search]: User selects keyword
Search for keyword on Amazon > Retrieve item price [icon: dollar-sign] 
Retrieve item price > Output result to Excel [icon: excel] 
Output result to Excel > End
Wait for user input > Close modal [icon: x]: User clicks cancel
Close modal > End [shape: oval, icon: check]

// Define Groups
For each keyword in the list [icon: repeat] {
  Search for keyword on Amazon
  Retrieve item price 
  Output result to Excel
}
`,
};
