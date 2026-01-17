/**
 * Build Trigger Custom Resource Handler
 * 
 * Triggers CodeBuild project and waits for completion.
 * Used to ensure container image is built before AgentCore Runtime is created.
 * 
 * Validates: Requirements 6.3, 28
 */

import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
  BuildPhaseType,
  type BuildPhase,
} from '@aws-sdk/client-codebuild';
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceUpdateEvent,
} from 'aws-lambda';

const codebuildClient = new CodeBuildClient({});

// Poll interval in milliseconds
const POLL_INTERVAL_MS = 10000; // 10 seconds

// Maximum wait time in milliseconds (14 minutes to stay under 15 min Lambda timeout)
const MAX_WAIT_MS = 14 * 60 * 1000;

/**
 * Wait for build to complete
 */
async function waitForBuild(buildId: string): Promise<{ success: boolean; message: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    const response = await codebuildClient.send(
      new BatchGetBuildsCommand({
        ids: [buildId],
      })
    );

    const build = response.builds?.[0];
    if (!build) {
      return { success: false, message: 'Build not found' };
    }

    const status = build.buildStatus;
    console.log(`Build status: ${status}, phase: ${build.currentPhase}`);

    switch (status) {
      case 'SUCCEEDED':
        return { success: true, message: `Build ${buildId} succeeded` };
      case 'FAILED':
        const buildPhase = build.phases?.find((p: BuildPhase) => p.phaseType === BuildPhaseType.BUILD);
        return { success: false, message: `Build ${buildId} failed: ${buildPhase?.contexts?.[0]?.message || 'Unknown error'}` };
      case 'FAULT':
        return { success: false, message: `Build ${buildId} faulted` };
      case 'STOPPED':
        return { success: false, message: `Build ${buildId} was stopped` };
      case 'TIMED_OUT':
        return { success: false, message: `Build ${buildId} timed out` };
      case 'IN_PROGRESS':
        // Continue waiting
        break;
      default:
        console.log(`Unknown build status: ${status}`);
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { success: false, message: 'Timed out waiting for build to complete' };
}

/**
 * Lambda handler for CloudFormation custom resource
 */
export async function handler(
  event: CloudFormationCustomResourceEvent
): Promise<CloudFormationCustomResourceResponse> {
  console.log('Build trigger event:', JSON.stringify(event, null, 2));

  const projectName = event.ResourceProperties.ProjectName as string;
  const sourceHash = event.ResourceProperties.SourceHash as string;
  const physicalResourceId = `build-${projectName}-${sourceHash}`;

  try {
    if (event.RequestType === 'Delete') {
      // Nothing to clean up on delete
      const deleteEvent = event as CloudFormationCustomResourceDeleteEvent;
      return {
        Status: 'SUCCESS',
        PhysicalResourceId: deleteEvent.PhysicalResourceId || physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
      };
    }

    // For Create and Update, trigger a build
    console.log(`Starting build for project: ${projectName}`);

    const startResponse = await codebuildClient.send(
      new StartBuildCommand({
        projectName,
      })
    );

    const buildId = startResponse.build?.id;
    if (!buildId) {
      throw new Error('Failed to start build: no build ID returned');
    }

    console.log(`Build started: ${buildId}`);

    // Wait for build to complete
    const result = await waitForBuild(buildId);

    if (!result.success) {
      throw new Error(result.message);
    }

    console.log(result.message);

    return {
      Status: 'SUCCESS',
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {
        BuildId: buildId,
        Message: result.message,
      },
    };
  } catch (error) {
    console.error('Build trigger failed:', error);
    // For Update/Delete events, use existing PhysicalResourceId
    let existingPhysicalId = physicalResourceId;
    if (event.RequestType === 'Delete' || event.RequestType === 'Update') {
      existingPhysicalId = (event as CloudFormationCustomResourceDeleteEvent | CloudFormationCustomResourceUpdateEvent).PhysicalResourceId;
    }
    return {
      Status: 'FAILED',
      PhysicalResourceId: existingPhysicalId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Reason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
