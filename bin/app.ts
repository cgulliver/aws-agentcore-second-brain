#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IngressStack } from '../lib/ingress-stack';
import { CoreStack } from '../lib/core-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// Ingress Stack: Lambda Function URL + SQS Queue
const ingressStack = new IngressStack(app, 'SecondBrainIngressStack', {
  env,
  description: 'Second Brain Agent - Ingress (Lambda Function URL, SQS)',
});

// Core Stack: Worker Lambda + CodeCommit + DynamoDB + SES + AgentCore
const coreStack = new CoreStack(app, 'SecondBrainCoreStack', {
  env,
  description: 'Second Brain Agent - Core (Worker, CodeCommit, DynamoDB, SES, AgentCore)',
  ingressQueue: ingressStack.queue,
});

// Ensure Core Stack deploys after Ingress Stack
coreStack.addDependency(ingressStack);

app.synth();
