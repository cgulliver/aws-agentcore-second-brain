import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as s3Assets from 'aws-cdk-lib/aws-s3-assets';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

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

  /** ECR repository for classifier agent */
  public readonly ecrRepository: ecr.IRepository;

  /** Worker Lambda function */
  public readonly workerFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);

    // =========================================================================
    // Task 3.1: DynamoDB Idempotency Table
    // Validates: Requirements 21, 24a
    // =========================================================================
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

    // =========================================================================
    // Task 3.2: DynamoDB Conversation Context Table
    // Validates: Requirements 9.1, 9.3
    // =========================================================================
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

    // =========================================================================
    // Task 3.3: CodeCommit Repository
    // Validates: Requirements 11, 29, 40
    // =========================================================================
    this.repository = new codecommit.Repository(this, 'KnowledgeRepository', {
      repositoryName: 'second-brain-knowledge',
      description: 'Second Brain knowledge store (Markdown + receipts)',
    });

    // =========================================================================
    // Task 3.4: System Prompt Bootstrap Custom Resource
    // Validates: Requirements 29, 40
    // =========================================================================
    const bootstrapFunction = new lambdaNodejs.NodejsFunction(this, 'BootstrapFunction', {
      functionName: 'second-brain-bootstrap',
      description: 'Bootstrap CodeCommit repository with folder structure and system prompt',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.minutes(2),
      entry: path.join(__dirname, '../src/handlers/bootstrap.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/client-codecommit'],
      },
      environment: {
        REPOSITORY_NAME: this.repository.repositoryName,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // Grant bootstrap function permission to read/write CodeCommit
    this.repository.grantPullPush(bootstrapFunction);
    // Additional permissions needed for bootstrap (GetBranch, CreateCommit, GetFile)
    bootstrapFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'codecommit:GetBranch',
          'codecommit:CreateCommit',
          'codecommit:GetFile',
        ],
        resources: [this.repository.repositoryArn],
      })
    );

    // Custom resource to trigger bootstrap on first deploy
    const bootstrapProvider = new cr.Provider(this, 'BootstrapProvider', {
      onEventHandler: bootstrapFunction,
      logGroup: new logs.LogGroup(this, 'BootstrapProviderLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    new cdk.CustomResource(this, 'BootstrapResource', {
      serviceToken: bootstrapProvider.serviceToken,
      properties: {
        // Trigger on repository name change
        RepositoryName: this.repository.repositoryName,
      },
    });

    // =========================================================================
    // Task 3.5: ECR Repository for AgentCore Classifier
    // Validates: Requirements 6.3, 28
    // =========================================================================
    // Import existing ECR repository (created manually for initial image push)
    this.ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      'ClassifierRepository',
      'second-brain-classifier'
    );


    // =========================================================================
    // Task 3.6: CodeBuild Project for Classifier Container
    // Validates: Requirements 6.3, 28
    // =========================================================================
    
    // S3 Asset for agent source code
    const agentSourceAsset = new s3Assets.Asset(this, 'AgentSourceAsset', {
      path: path.join(__dirname, '../agent'),
    });

    // CodeBuild role with ECR and S3 permissions
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      inlinePolicies: {
        CodeBuildPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: 'CloudWatchLogs',
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/codebuild/*`],
            }),
            new iam.PolicyStatement({
              sid: 'ECRAccess',
              effect: iam.Effect.ALLOW,
              actions: [
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage',
                'ecr:GetAuthorizationToken',
                'ecr:PutImage',
                'ecr:InitiateLayerUpload',
                'ecr:UploadLayerPart',
                'ecr:CompleteLayerUpload',
              ],
              resources: [this.ecrRepository.repositoryArn, '*'],
            }),
            new iam.PolicyStatement({
              sid: 'S3SourceAccess',
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:GetObjectVersion'],
              resources: [`${agentSourceAsset.bucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    // CodeBuild project for ARM64 Docker image
    const buildProject = new codebuild.Project(this, 'ClassifierBuildProject', {
      projectName: 'second-brain-classifier-build',
      description: 'Build classifier agent Docker image for AgentCore Runtime',
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true, // Required for Docker builds
      },
      source: codebuild.Source.s3({
        bucket: agentSourceAsset.bucket,
        path: agentSourceAsset.s3ObjectKey,
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
            ],
          },
          build: {
            commands: [
              'echo Build started on `date`',
              'echo Building the Docker image for classifier agent ARM64...',
              'docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG .',
              'docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
            ],
          },
          post_build: {
            commands: [
              'echo Build completed on `date`',
              'echo Pushing the Docker image...',
              'docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$IMAGE_REPO_NAME:$IMAGE_TAG',
              'echo ARM64 Docker image pushed successfully',
            ],
          },
        },
      }),
      environmentVariables: {
        AWS_DEFAULT_REGION: { value: this.region },
        AWS_ACCOUNT_ID: { value: this.account },
        IMAGE_REPO_NAME: { value: this.ecrRepository.repositoryName },
        IMAGE_TAG: { value: 'latest' },
      },
    });

    // =========================================================================
    // Task 3.7: AgentCore Runtime Resource
    // Validates: Requirements 6.3, 28
    // =========================================================================

    // Classifier Model Selection
    // Default: Nova Micro (~$0.035/1M input) - 99% cheaper than Claude Sonnet 4
    // Options: amazon.nova-micro-v1:0, amazon.nova-lite-v1:0, anthropic.claude-3-5-haiku-20241022-v1:0
    const classifierModel = this.node.tryGetContext('classifierModel') || 'amazon.nova-micro-v1:0';

    // IAM role for AgentCore execution
    const agentCoreRole = new iam.Role(this, 'AgentCoreRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      inlinePolicies: {
        AgentCorePolicy: new iam.PolicyDocument({
          statements: [
            // ECR permissions for pulling container image
            new iam.PolicyStatement({
              sid: 'ECRAuth',
              effect: iam.Effect.ALLOW,
              actions: ['ecr:GetAuthorizationToken'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              sid: 'ECRPull',
              effect: iam.Effect.ALLOW,
              actions: [
                'ecr:BatchGetImage',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchCheckLayerAvailability',
              ],
              resources: [this.ecrRepository.repositoryArn],
            }),
            // Bedrock model invocation
            new iam.PolicyStatement({
              sid: 'BedrockInvoke',
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: ['*'],
            }),
            // CloudWatch Logs
            new iam.PolicyStatement({
              sid: 'CloudWatchLogs',
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/*`],
            }),
          ],
        }),
      },
    });

    // =========================================================================
    // Task 31.1: AgentCore Memory Resource (v2 - Behavioral Learning)
    // Validates: Requirements 58.1, 58.2
    // =========================================================================

    // AgentCore Memory for behavioral learning (user preferences, patterns)
    const agentMemory = new cdk.CfnResource(this, 'AgentMemory', {
      type: 'AWS::BedrockAgentCore::Memory',
      properties: {
        Name: 'second_brain_memory',
        Description: 'Memory for Second Brain agent - stores user preferences and learned patterns',
        EventExpiryDuration: 30, // days
        MemoryStrategies: [
          {
            UserPreferenceMemoryStrategy: {
              Name: 'PreferenceLearner',
              Namespaces: ['/preferences/{actorId}'],
            },
          },
          {
            SemanticMemoryStrategy: {
              Name: 'PatternExtractor',
              Namespaces: ['/patterns/{actorId}'],
            },
          },
        ],
      },
    });

    // Grant AgentCore role permissions for Memory operations (Task 31.4)
    agentCoreRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AgentCoreMemory',
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:GetMemory',
          'bedrock-agentcore:CreateMemoryRecord',
          'bedrock-agentcore:SearchMemoryRecords',
          'bedrock-agentcore:DeleteMemoryRecord',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:memory/*`,
        ],
      })
    );

    // AgentCore Runtime (CfnRuntime)
    // Note: Using L1 construct as L2 may not be available yet
    // Task 31.2: Pass MEMORY_ID to Runtime via environment variable
    // Include source hash in description to force Runtime update on code changes
    const agentRuntime = new cdk.CfnResource(this, 'ClassifierRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: 'second_brain_classifier',
        Description: `Second Brain classifier agent (build: ${agentSourceAsset.assetHash.substring(0, 8)})`,
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${this.ecrRepository.repositoryUri}:latest`,
          },
        },
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC',
        },
        ProtocolConfiguration: 'HTTP',
        RoleArn: agentCoreRole.roleArn,
        EnvironmentVariables: {
          KNOWLEDGE_REPO_NAME: this.repository.repositoryName,
          AWS_DEFAULT_REGION: this.region,
          MEMORY_ID: agentMemory.getAtt('MemoryId').toString(),
          MODEL_ID: classifierModel,
        },
      },
    });

    // Runtime depends on Memory being created first
    agentRuntime.node.addDependency(agentMemory);

    // =========================================================================
    // Task 3.8: Build Trigger Custom Resource
    // Validates: Requirements 6.3, 28
    // =========================================================================

    // Lambda function to trigger CodeBuild and wait for completion
    const buildTriggerFunction = new lambdaNodejs.NodejsFunction(this, 'BuildTriggerFunction', {
      functionName: 'second-brain-build-trigger',
      description: 'Trigger CodeBuild and wait for completion',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.minutes(15),
      entry: path.join(__dirname, '../src/handlers/build-trigger.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/client-codebuild'],
      },
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // Grant build trigger function permission to start and monitor builds
    buildTriggerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
        resources: [buildProject.projectArn],
      })
    );

    // Custom resource provider for build trigger
    const buildTriggerProvider = new cr.Provider(this, 'BuildTriggerProvider', {
      onEventHandler: buildTriggerFunction,
      logGroup: new logs.LogGroup(this, 'BuildTriggerProviderLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const triggerBuild = new cdk.CustomResource(this, 'TriggerBuild', {
      serviceToken: buildTriggerProvider.serviceToken,
      properties: {
        ProjectName: buildProject.projectName,
        // Force rebuild when agent source changes
        SourceHash: agentSourceAsset.assetHash,
      },
    });

    // AgentCore Runtime depends on successful build
    agentRuntime.node.addDependency(triggerBuild);

    // =========================================================================
    // Task 3.11: SES Email Identity
    // Validates: Requirements 17, 28, 52
    // =========================================================================
    
    // Note: SES email identity is managed outside CDK (verified manually)
    // The sender email should be configured via context or environment
    const senderEmail = this.node.tryGetContext('senderEmail') || 'noreply@example.com';

    // =========================================================================
    // Task 3.12: SSM Parameter for Conversation Context TTL
    // Validates: Requirements 9.5, 9.6, 9.7
    // =========================================================================
    
    const conversationTtlParam = new ssm.StringParameter(this, 'ConversationTtlParam', {
      parameterName: '/second-brain/conversation-ttl-seconds',
      description: 'TTL for conversation context records in seconds (default: 3600 = 1 hour)',
      stringValue: '3600',
      tier: ssm.ParameterTier.STANDARD,
    });

    // =========================================================================
    // SSM Parameter References (must be created manually before deploy)
    // =========================================================================
    
    const botTokenParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'SlackBotToken',
      { parameterName: '/second-brain/slack-bot-token' }
    );

    const mailDropParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      'OmniFocusMailDrop',
      { parameterName: '/second-brain/omnifocus-maildrop-email' }
    );

    // =========================================================================
    // Task 3.9: Worker Lambda Function
    // Validates: Requirements 3, 28
    // =========================================================================
    
    this.workerFunction = new lambdaNodejs.NodejsFunction(this, 'WorkerFunction', {
      functionName: 'second-brain-worker',
      description: 'Process Slack events - classify, store, route tasks, reply',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60), // AgentCore calls may take time
      entry: path.join(__dirname, '../src/handlers/worker.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-codecommit',
          '@aws-sdk/client-ses',
          '@aws-sdk/client-ssm',
          '@aws-sdk/client-bedrock-agent-runtime',
        ],
      },
      environment: {
        REPOSITORY_NAME: this.repository.repositoryName,
        IDEMPOTENCY_TABLE: this.idempotencyTable.tableName,
        CONVERSATION_TABLE: this.conversationTable.tableName,
        AGENT_RUNTIME_ARN: agentRuntime.getAtt('AgentRuntimeArn').toString(),
        BOT_TOKEN_PARAM: botTokenParam.parameterName,
        MAILDROP_PARAM: mailDropParam.parameterName,
        CONVERSATION_TTL_PARAM: conversationTtlParam.parameterName,
        SES_FROM_EMAIL: senderEmail,
        EMAIL_MODE: 'live', // Production mode - emails sent to OmniFocus
        NODE_OPTIONS: '--enable-source-maps',
        DEPLOY_VERSION: '6', // Add project status query filtering
      },
    });

    // Add SQS event source from Ingress queue
    this.workerFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(props.ingressQueue, {
        batchSize: 1, // Process one event at a time for simplicity
        maxBatchingWindow: cdk.Duration.seconds(0),
        reportBatchItemFailures: true,
      })
    );

    // =========================================================================
    // Task 3.10: Worker Lambda Permissions
    // Validates: Requirements 23, 25
    // =========================================================================

    // DynamoDB permissions
    this.idempotencyTable.grantReadWriteData(this.workerFunction);
    this.conversationTable.grantReadWriteData(this.workerFunction);

    // CodeCommit permissions
    this.repository.grantPullPush(this.workerFunction);
    // Also need GetFile for reading system prompt
    this.workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'codecommit:GetFile',
          'codecommit:GetFolder',
          'codecommit:GetBranch',
          'codecommit:CreateCommit',
          'codecommit:GetCommit',
        ],
        resources: [this.repository.repositoryArn],
      })
    );

    // SSM permissions
    botTokenParam.grantRead(this.workerFunction);
    mailDropParam.grantRead(this.workerFunction);
    conversationTtlParam.grantRead(this.workerFunction);

    // SES send email permission
    this.workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      })
    );

    // AgentCore invoke permission
    this.workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock-agentcore:InvokeAgentRuntime',
          'bedrock-agentcore:InvokeAgentRuntimeForUser',
        ],
        resources: [
          agentRuntime.getAtt('AgentRuntimeArn').toString(),
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:runtime/*`,
        ],
      })
    );

    // CloudWatch metrics permission
    this.workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'SecondBrain',
          },
        },
      })
    );

    // =========================================================================
    // Stack Outputs
    // =========================================================================

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

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: this.ecrRepository.repositoryUri,
      description: 'ECR Repository URI for classifier agent',
    });

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: agentRuntime.getAtt('AgentRuntimeArn').toString(),
      description: 'AgentCore Runtime ARN',
    });

    new cdk.CfnOutput(this, 'AgentMemoryId', {
      value: agentMemory.getAtt('MemoryId').toString(),
      description: 'AgentCore Memory ID for behavioral learning',
    });

    new cdk.CfnOutput(this, 'WorkerFunctionArn', {
      value: this.workerFunction.functionArn,
      description: 'Worker Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'ClassifierModelId', {
      value: classifierModel,
      description: 'Bedrock model ID used for classification',
    });
  }
}
