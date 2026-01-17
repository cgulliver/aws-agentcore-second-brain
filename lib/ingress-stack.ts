import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

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

  constructor(scope: Construct, id: string, props?: IngressStackProps) {
    super(scope, id, props);

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

    // TODO: Task 2.2 - Create Ingress Lambda function
    // TODO: Task 2.3 - Configure SSM Parameter references

    // Stack outputs
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
  }
}
