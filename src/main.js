import * as core from '@actions/core'
import * as github from '@actions/github'

/**
 * Parses a comma-separated string input into an array of trimmed, non-empty strings.
 *
 * @param {string} input
 * @returns {string[]}
 */
function parseInputList(input) {
  return input
    ? input
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item)
    : []
}

/**
 * Fetches and parses the CODEOWNERS file from the specified branch.
 *
 * @param {import('@octokit/rest').Octokit} octokit - GitHub client
 * @param {object} repo - Repository context
 * @param {string} branch - Branch to fetch CODEOWNERS from
 * @param {string[]} changedFiles - Array of changed file paths in the PR
 * @returns {Promise<{reviewers: string[], teams: string[]}>} Parsed reviewers and teams
 */
async function getCodeOwnersReviewers(octokit, repo, branch, changedFiles) {
  try {
    // Try different possible locations for CODEOWNERS file
    const codeOwnersLocations = [
      'CODEOWNERS',
      '.github/CODEOWNERS',
      'docs/CODEOWNERS'
    ]

    let codeOwnersContent = null
    let foundLocation = null

    for (const location of codeOwnersLocations) {
      try {
        const response = await octokit.rest.repos.getContent({
          owner: repo.owner,
          repo: repo.repo,
          path: location,
          ref: branch
        })

        if (
          response.data &&
          !Array.isArray(response.data) &&
          response.data.content
        ) {
          codeOwnersContent = Buffer.from(
            response.data.content,
            'base64'
          ).toString('utf8')
          foundLocation = location
          break
        }
      } catch (error) {
        // File doesn't exist at this location, try next
        continue
      }
    }

    if (!codeOwnersContent) {
      core.info('No CODEOWNERS file found in repository')
      return { reviewers: [], teams: [] }
    }

    core.info(`Found CODEOWNERS file at: ${foundLocation}`)

    // Parse CODEOWNERS file
    const lines = codeOwnersContent.split('\n')
    const rules = []

    for (const line of lines) {
      const trimmedLine = line.trim()

      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue
      }

      const parts = trimmedLine.split(/\s+/)
      if (parts.length >= 2) {
        const pattern = parts[0]
        const owners = parts.slice(1)
        rules.push({ pattern, owners })
      }
    }

    // Find matching rules for changed files
    const matchingOwners = new Set()

    for (const file of changedFiles) {
      for (const rule of rules.reverse()) {
        // Reverse to match last rule first (as per CODEOWNERS spec)
        if (matchesPattern(file, rule.pattern)) {
          rule.owners.forEach((owner) => matchingOwners.add(owner))
          break // Stop at first match for this file
        }
      }
    }

    // Separate users and teams
    const reviewers = []
    const teams = []

    for (const owner of matchingOwners) {
      if (owner.startsWith('@')) {
        const cleanOwner = owner.substring(1) // Remove @ prefix
        if (cleanOwner.includes('/')) {
          // It's a team (org/team format)
          teams.push(cleanOwner.split('/')[1]) // Extract team name
        } else {
          // It's a user
          reviewers.push(cleanOwner)
        }
      }
    }

    return { reviewers, teams }
  } catch (error) {
    core.warning(`Failed to fetch CODEOWNERS: ${error.message}`)
    return { reviewers: [], teams: [] }
  }
}

/**
 * Check if a file path matches a CODEOWNERS pattern.
 *
 * @param {string} filePath - The file path to check
 * @param {string} pattern - The CODEOWNERS pattern
 * @returns {boolean} True if the pattern matches
 */
function matchesPattern(filePath, pattern) {
  // Convert glob pattern to regex
  // This is a simplified implementation - you might want to use a proper glob library
  if (pattern === '*') {
    return true
  }

  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1)
    return filePath.startsWith(prefix)
  }

  if (pattern.startsWith('*')) {
    const suffix = pattern.slice(1)
    return filePath.endsWith(suffix)
  }

  if (pattern.includes('*')) {
    const regexPattern = pattern.replace(/\*/g, '.*')
    return new RegExp(`^${regexPattern}$`).test(filePath)
  }

  return filePath === pattern || filePath.startsWith(pattern + '/')
}

/**
 * Gets the list of changed files in a pull request.
 *
 * @param {import('@octokit/rest').Octokit} octokit - GitHub client
 * @param {object} repo - Repository context
 * @param {number} pullNumber - Pull request number
 * @returns {Promise<string[]>} Array of changed file paths
 */
async function getChangedFiles(octokit, repo, pullNumber) {
  try {
    const response = await octokit.rest.pulls.listFiles({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: pullNumber
    })

    return response.data.map((file) => file.filename)
  } catch (error) {
    core.warning(`Failed to get changed files: ${error.message}`)
    return []
  }
}

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run() {
  try {
    // Get inputs
    const targetBranch = core.getInput('branch')
    const reviewersInput = core.getInput('reviewers')
    const teamReviewersInput = core.getInput('team-reviewers')
    const useCodeOwners = core.getInput('use-codeowners') === 'true'
    const codeOwnersBranch = core.getInput('codeowners-branch') || 'main'
    const token = core.getInput('token')

    // Validate inputs
    if (!targetBranch) {
      throw new Error('Branch input is required')
    }
    if (!reviewersInput && !teamReviewersInput && !useCodeOwners) {
      throw new Error(
        'At least one of reviewers, team-reviewers, or use-codeowners must be provided'
      )
    }

    // Get the current context
    const context = github.context

    // Check if this is a pull request event
    if (
      context.eventName !== 'pull_request' &&
      context.eventName !== 'pull_request_target'
    ) {
      core.info('This action only runs on pull request events')
      return
    }

    const pullRequest = context.payload.pull_request
    if (!pullRequest) {
      throw new Error('Could not get pull request from context')
    }

    // Check if the target branch matches
    const prTargetBranch = pullRequest.base.ref
    core.info(`Pull request target branch: ${prTargetBranch}`)
    core.info(`Configured target branch: ${targetBranch}`)

    if (prTargetBranch !== targetBranch) {
      core.info(
        `Target branch ${prTargetBranch} does not match configured branch ${targetBranch}. Skipping reviewer assignment.`
      )
      return
    }

    // Create GitHub client
    const octokit = github.getOctokit(token)

    // Parse reviewers and team reviewers from inputs
    let reviewers = parseInputList(reviewersInput)
    let teamReviewers = parseInputList(teamReviewersInput)

    // Get reviewers from CODEOWNERS if enabled
    if (useCodeOwners) {
      core.info(`Fetching CODEOWNERS from branch: ${codeOwnersBranch}`)

      const changedFiles = await getChangedFiles(
        octokit,
        context.repo,
        pullRequest.number
      )
      core.info(`Changed files: ${changedFiles.join(', ')}`)

      const codeOwnersReviewers = await getCodeOwnersReviewers(
        octokit,
        context.repo,
        codeOwnersBranch,
        changedFiles
      )

      // Merge with input reviewers (remove duplicates)
      reviewers = [...new Set([...reviewers, ...codeOwnersReviewers.reviewers])]
      teamReviewers = [
        ...new Set([...teamReviewers, ...codeOwnersReviewers.teams])
      ]

      core.info(
        `CODEOWNERS reviewers found: ${codeOwnersReviewers.reviewers.join(', ')}`
      )
      if (codeOwnersReviewers.teams.length > 0) {
        core.info(
          `CODEOWNERS teams found: ${codeOwnersReviewers.teams.join(', ')}`
        )
      }
    }

    // Remove the PR author from reviewers
    const prAuthor = pullRequest.user?.login
    if (prAuthor) {
      reviewers = reviewers.filter((reviewer) => reviewer !== prAuthor)
    }

    if (reviewers.length === 0 && teamReviewers.length === 0) {
      core.info('No reviewers to add after filtering')
      return
    }

    core.info(`Final reviewers to add: ${reviewers.join(', ')}`)
    if (teamReviewers.length > 0) {
      core.info(`Final team reviewers to add: ${teamReviewers.join(', ')}`)
    }

    // Request reviewers
    const requestData = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pullRequest.number,
      ...(reviewers.length > 0 && { reviewers }),
      ...(teamReviewers.length > 0 && { team_reviewers: teamReviewers })
    }

    core.debug(`Request reviewers payload: ${JSON.stringify(requestData)}`)

    const response = await octokit.rest.pulls.requestReviewers(requestData)

    // Set outputs
    const addedReviewers =
      response.data.requested_reviewers?.map((r) => r.login) || []
    const addedTeams = response.data.requested_teams?.map((t) => t.slug) || []

    core.setOutput('reviewers-added', addedReviewers.join(','))
    core.setOutput('teams-added', addedTeams.join(','))

    core.info(`Successfully added reviewers: ${addedReviewers.join(', ')}`)
    if (addedTeams.length > 0) {
      core.info(`Successfully added team reviewers: ${addedTeams.join(', ')}`)
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
