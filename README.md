# AI-Powered-Incident-Investigation-System

Sample Project for Generative AI using LangChain and Zod

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Install Dependencies

```bash
npm install
```

This will install all required dependencies including:
- @langchain/community
- @langchain/core
- @langchain/ollama
- langchain
- openai
- pdf-parse
- zod
- dotenv
- hnswlib-node
- TypeScript
- ts-node

## Start Chroma (Required for Day 4+ Retrieval Tasks)

Run Chroma from the project root so vector data is stored in the local `./chroma` folder.

### 1) Start Chroma

```bash
.venv/bin/chroma run --host 127.0.0.1 --port 8000 --path ./chroma
```

If you do not use a local virtual environment, use:

```bash
chroma run --host 127.0.0.1 --port 8000 --path ./chroma
```

If you see `chroma: command not found`, use the `.venv/bin/chroma ...` command (or activate your venv first with `source .venv/bin/activate`).

### 2) Verify Chroma is running

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Expected: a process listening on `127.0.0.1:8000`.

### 3) Run retrieval tasks in another terminal

```bash
npm run run:rag-pdf-eval
npm run run:day6-chunking
npm run run:day7-query-opt
```

### 4) Stop Chroma

Press `Ctrl + C` in the terminal where Chroma is running.

## Docker & Qdrant Setup

For comprehensive Docker and Qdrant vector database setup instructions, see [DOCKER_QDRANT_SETUP.md](DOCKER_QDRANT_SETUP.md).

This includes:
- Docker installation and basic commands
- Qdrant setup and configuration
- Docker Compose configuration
- API examples and troubleshooting

## Usage

To run any TypeScript file in this project, use the following command:

```bash
npx ts-node tasks/{fileName}.ts
```

## Environment Variables

Make sure to create a `.env` file in the root directory if required by your scripts, with necessary API keys and configuration.

## System Architecture

The platform performs end-to-end incident investigation by combining hybrid retrieval, multi-agent reasoning, and knowledge graph analysis.

### Architecture Overview

```mermaid
flowchart TD
	subgraph DS[Data Sources]
		L[Logs]
		T[Incident Tickets]
		R[Runbooks]
		D[Deployment History]
		K[Knowledge Graph]
	end

	subgraph P[Processing]
		N[Data Cleaning and Normalization]
		E[Embedding and Indexing]
	end

	subgraph HR[Hybrid Retrieval]
		VS[Vector Search]
		KS[Keyword Search]
		C[Result Combiner and Ranker]
	end

	subgraph MA[Multi-Agent Reasoning]
		PA[Planner Agent]
		LA[Log Analysis Agent]
		TA[Timeline Agent]
		GA[Graph Agent]
		HA[Hypothesis Agent]
		CA[Critic Agent]
	end

	subgraph O[Output]
		RG[Report Generator]
		FR[Final Incident Report]
	end

	L --> N
	T --> N
	R --> N
	D --> N
	K --> N

	N --> E
	E --> VS
	E --> KS
	VS --> C
	KS --> C

	C --> PA
	PA --> LA
	LA --> TA
	TA --> GA
	GA --> HA
	HA --> CA

	CA --> RG
	RG --> FR
```

### Investigation Flow

1. Ingest and normalize data from operational logs, incident tickets, runbooks, deployment metadata, and graph entities.
2. Build embeddings and indexes for semantic retrieval and fast keyword retrieval.
3. Run hybrid retrieval to improve recall and precision before reasoning.
4. Execute specialized agents in sequence to plan, correlate, validate, and challenge hypotheses.
5. Generate a structured final report with evidence, confidence, and action recommendations.

### Final Incident Report Schema

The report should include:

- Root cause analysis
- Timeline of events
- Affected services
- Supporting evidence with citations
- Confidence score
- Recommended actions

## Prerequisite GenAI Knowledge for This Course

### Retrieval-Augmented Generation (RAG)

Combines retrieval from external data sources (logs, tickets, docs) with LLMs to generate grounded, context-aware responses.

### Multi-Agent Systems

Uses multiple specialized agents that collaborate to decompose tasks, analyze data, and generate structured outputs.

### Knowledge Graphs

Represents system entities and their relationships to enable dependency analysis and impact tracing.

### Multi-Hop Reasoning

Connects information across multiple sources (logs, deployments, graph) to derive root cause insights.

### Evaluation and Grounding

Ensures outputs are accurate, evidence-based, and free from hallucinations through validation and scoring.

## Phase 1: Data Sourcing

To ensure both realism and controlled complexity, the dataset for this project will be created by combining multiple sources.

### Data Source Strategy

1. Kaggle or public datasets
2. LLM-generated synthetic data

### Kaggle or Public Datasets

Used to introduce real-world patterns, noise, and variability in data.

#### Recommended Dataset

IT Incident Management Dataset (available on Kaggle)

#### Dataset Contents

- Ticket descriptions
- Priority levels
- Issue categories
- Resolution notes

#### Purpose in This Project

- Enable historical reasoning based on past incidents
- Identify recurring patterns and common failure types
- Simulate realistic user-reported issues and system behavior

### LLM-Generated Synthetic Data

Used to simulate specific scenarios such as failures and edge cases, while preserving controlled experimentation.

To simulate realistic production scenarios, synthetic data should intentionally include:

- Noise in logs and tickets
- Inconsistencies across sources
- Partial or missing information

This helps mimic real-world systems and stress-test root cause investigation workflows.
