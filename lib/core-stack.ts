import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface CoreStackProps extends cdk.StackProps {
  /** SQS Queue from Ingress Stack */
  ingressQueue: sqs.IQueue;
}

/**
 * Core Stack: Main processing infrastructure
 * 
 * Components:
 * - Worker Lambda (SQS event source)
 * - DynamoDB Tables (idempotency, conversation context)
 * - CodeCommit Repository (knowledge store)
 * - SES Email Identity
 * - AgentCore Runtime (ECR + CodeBuild + CfnRuntime)
 * 
 * Validates: Requirement 28 (CDK Infrastructure)
 */
export class CoreStack extends cdk.Stack {
  /** DynamoDB table for idempotency tracking */
  public readonly idempotencyTable: dynamodb.Table;
  
  /** DynamoDB table for conversation context */
  public readonly conversationTable: dynamodb.Table;
  
  /** CodeCommit repository for knowledge storage */
  public readonly repository: codecommit.Repository;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);

    // DynamoDB: Idempotency table (keyed by event_id, 7-day TTL)
    this.idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      tableName: 'second-brain-idempotency',
      partitionKey: {
        name: 'event_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // DynamoDB: Conversation context table (keyed by session_id, configurable TTL)
    this.conversationTable = new dynamodb.Table(this, 'ConversationTable', {
      tableName: 'second-brain-conversations',
      partitionKey: {
        name: 'session_id', // Format: {channel_id}#{user_id}
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // CodeCommit: Knowledge repository
    this.repository = new codecommit.Repository(this, 'KnowledgeRepository', {
      repositoryName: 'second-brain-knowledge',
      description: 'Second Brain knowledge store (Markdown + receipts)',
    });

    // TODO: Task 3.4 - Create system prompt bootstrap custom resource
    // TODO: Task 3.5 - Create ECR repository for AgentCore classifier
    // TODO: Task 3.6 - Create CodeBuild project for classifier container
    // TODO: Task 3.7 - Create AgentCore Runtime resource
    // TODO: Task 3.8 - Create build trigger custom resource
    // TODO: Task 3.9 - Create Worker Lambda function
    // TODO: Task 3.10 - Configure Worker Lambda permissions
    // TODO: Task 3.11 - Create SES email identity
    // TODO: Task 3.12 - Add SSM parameter for conversation context TTL

    // Stack outputs
    new cdk.CfnOutput(this, 'IdempotencyTableName', {
      value: this.idempotencyTable.tableName,
      description: 'DynamoDB Idempotency Table Name',
    });

    new cdk.CfnOutput(this, 'ConversationTableName', {
      value: this.conversationTable.tableName,
      description: 'DynamoDB Conversation Context Table Name',
    });

    new cdk.CfnOutput(this, 'RepositoryCloneUrl', {
      value: this.repository.repositoryCloneUrlHttp,
      description: 'CodeCommit Repository Clone URL (HTTPS)',
    });

    new cdk.CfnOutput(this, 'RepositoryArn', {
      value: this.repository.repositoryArn,
      description: 'CodeCommit Repository ARN',
    });
  }
}
