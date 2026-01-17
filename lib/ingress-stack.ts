import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface IngressStackProps extends cdk.StackProps {
  // No additional props needed for Ingress Stack
}

/**
 * Ingress Stack: Handles Slack webhook requests
 * 
 * Components:
 * - Lambda Function URL (Auth = NONE, application-layer HMAC verification)
 * - SQS Queue for async event processing
 * - SQS Dead Letter Queue for failed messages
 * 
 * Validates: Requirement 28 (CDK Infrastructure)
 */
export class IngressStack extends cdk.Stack {
  /** SQS Queue for event processing - exported for Core Stack */
  public readonly queue: sqs.Queue;
  
  /** Lambda Function URL for Slack webhook */
  public readonly functionUrl: lambda.FunctionUrl;
  
  /** Ingress Lambda function */
  public readonly ingressFunction: lambda.Function;

  constructor(scope: Construct, id: string, props?: IngressStackProps) {
    super(scope, id, props);

    // =========================================================================
    // Task 2.1: SQS Queue with DLQ
    // Validates: Requirements 3, 28
    // =========================================================================

    // Dead Letter Queue for failed messages (14-day retention)
    const dlq = new sqs.Queue(this, 'IngressDLQ', {
      queueName: 'second-brain-ingress-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Primary SQS Queue for event processing
    this.queue = new sqs.Queue(this, 'IngressQueue', {
      queueName: 'second-brain-ingress',
      visibilityTimeout: cdk.Duration.seconds(90), // 1.5x Lambda timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // =========================================================================
    // Task 2.3: SSM Parameter references
    // Validates: Requirements 23, 25
    // =========================================================================

    // Reference to Slack signing secret (must be created manually before deploy)
    const signingSecretParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'SlackSigningSecret',
      {
        parameterName: '/second-brain/slack-signing-secret',
      }
    );

    // =========================================================================
    // Task 2.2: Ingress Lambda function
    // Validates: Requirements 3, 28
    // =========================================================================

    // Ingress Lambda function
    this.ingressFunction = new lambdaNodejs.NodejsFunction(this, 'IngressFunction', {
      functionName: 'second-brain-ingress',
      description: 'Slack webhook handler - verifies signatures and enqueues events',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10), // Must respond within 3s, but allow buffer
      entry: path.join(__dirname, '../src/handlers/ingress.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: [
          '@aws-sdk/client-sqs',
          '@aws-sdk/client-ssm',
        ],
      },
      environment: {
        QUEUE_URL: this.queue.queueUrl,
        SIGNING_SECRET_PARAM: signingSecretParam.parameterName,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // Grant Lambda permission to send messages to SQS
    this.queue.grantSendMessages(this.ingressFunction);

    // Grant Lambda permission to read signing secret from SSM
    signingSecretParam.grantRead(this.ingressFunction);

    // Lambda Function URL (Auth = NONE for Slack webhooks)
    // Application-layer HMAC verification handles authentication
    this.functionUrl = this.ingressFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['content-type', 'x-slack-signature', 'x-slack-request-timestamp'],
      },
    });

    // =========================================================================
    // Task 2.4: Stack outputs
    // Validates: Requirement 28
    // =========================================================================

    new cdk.CfnOutput(this, 'QueueArn', {
      value: this.queue.queueArn,
      description: 'SQS Queue ARN for Core Stack',
      exportName: 'SecondBrainIngressQueueArn',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: this.queue.queueUrl,
      description: 'SQS Queue URL',
      exportName: 'SecondBrainIngressQueueUrl',
    });

    new cdk.CfnOutput(this, 'DLQArn', {
      value: dlq.queueArn,
      description: 'Dead Letter Queue ARN',
    });

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: this.functionUrl.url,
      description: 'Lambda Function URL for Slack webhook configuration',
      exportName: 'SecondBrainIngressFunctionUrl',
    });

    new cdk.CfnOutput(this, 'FunctionArn', {
      value: this.ingressFunction.functionArn,
      description: 'Ingress Lambda Function ARN',
    });
  }
}
