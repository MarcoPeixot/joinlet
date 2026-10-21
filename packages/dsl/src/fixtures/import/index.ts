/** Small importer fixtures (kept as strings so tests need no filesystem access). */

export const shopD2 = `# Loja online
direction: down

web: Web App { shape: circle }
backend: {
  api: API Gateway
  db: Postgres { shape: cylinder }
  api -> db: consulta
  style: { fill: red }
}
web -> backend.api: HTTPS
backend.db <-> cache
cache -- "my store"
users.style.fill: blue
`;

export const mainTf = `# Web stack
provider "aws" { region = "us-east-1" }

resource "aws_instance" "web" {
  ami           = "ami-123"
  instance_type = "t3.micro"
  tags = { Name = "Web Server" } // trailing
  user_data     = "\${aws_db_instance.main.address}"
}

resource "aws_db_instance" "main" {
  engine = "postgres"
  /* aws_s3_bucket.logs in a comment is not a reference */
}

resource "aws_s3_bucket" "logs" {
  bucket = "logs"
  depends_on = [aws_db_instance.main]
}

resource "google_compute_instance" "vm" {
  name = "aws_instance.web"
}

resource "aws_instance" "many" {
  count = 3
  subnet_id = aws_subnet.a.id
}

module "vpc" {
  source = "./vpc"
}
`;

export const petstoreYaml = `openapi: 3.0.3
info:
  title: Loja de Pets
  version: 1.0.0
servers:
  - url: https://api.example.com
tags:
  - name: pedidos
  - name: estoque
paths:
  /pedidos:
    get:
      tags: [pedidos]
      summary: Lista pedidos
      operationId: listOrders
    post:
      tags: [pedidos]
      summary: Cria pedido
  /pedidos/{id}:
    get:
      tags: [pedidos]
      responses:
        "200":
          content:
            application/json:
              schema:
                $ref: "https://other.example.com/schemas/order.json"
  /estoque:
    get:
      tags: [estoque]
      responses:
        "200":
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Item"
components:
  schemas:
    Item: { type: object }
`;

export const shopK8s = `apiVersion: v1
kind: Namespace
metadata:
  name: shop
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: shop
spec:
  template:
    metadata:
      labels:
        app: web
        tier: front
    spec:
      containers:
        - name: web
          image: nginx
          envFrom:
            - configMapRef:
                name: web-config
            - secretRef:
                name: web-secret
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: web-data
---
apiVersion: v1
kind: Service
metadata:
  name: web-svc
  namespace: shop
spec:
  selector:
    app: web
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ing
  namespace: shop
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            backend:
              service:
                name: web-svc
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
  namespace: shop
data:
  KEY: value
---
apiVersion: v1
kind: Secret
metadata:
  name: web-secret
  namespace: shop
data:
  password: ZXhhbXBsZQ==
stringData:
  token: example-token
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: web-data
  namespace: shop
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: pdb
  namespace: shop
`;
