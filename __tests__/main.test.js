/**
 * Unit tests for the action's main functionality, src/main.js
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as github from '../__fixtures__/github.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => github)

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Reset github context to default
    github.context.eventName = 'pull_request'
    github.context.payload.pull_request = {
      number: 123,
      base: { ref: 'main' }
    }

    // Ensure getOctokit returns the mockOctokit
    github.getOctokit.mockReturnValue(github.mockOctokit)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Successfully adds reviewers when branch matches', async () => {
    // Set up inputs
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return 'user1,user2'
        case 'team-reviewers':
          return 'team1'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    // Mock successful API response
    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [{ login: 'user1' }, { login: 'user2' }],
        requested_teams: [{ slug: 'team1' }]
      }
    })

    await run()

    // Verify API was called with correct parameters
    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['user1', 'user2'],
        team_reviewers: ['team1']
      }
    )

    // Verify outputs were set
    expect(core.setOutput).toHaveBeenCalledWith(
      'reviewers-added',
      'user1,user2'
    )
    expect(core.setOutput).toHaveBeenCalledWith('teams-added', 'team1')
  })

  it('Skips when branch does not match', async () => {
    // Set up inputs with different target branch
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'develop'
        case 'reviewers':
          return 'user1,user2'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    await run()

    // Verify API was not called
    expect(
      github.mockOctokit.rest.pulls.requestReviewers
    ).not.toHaveBeenCalled()

    // Verify no outputs were set
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('Skips when not a pull request event', async () => {
    // Change event type
    github.context.eventName = 'push'

    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return 'user1,user2'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    await run()

    // Verify API was not called
    expect(
      github.mockOctokit.rest.pulls.requestReviewers
    ).not.toHaveBeenCalled()
  })

  it('Handles only individual reviewers', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return 'user1,user2'
        case 'team-reviewers':
          return ''
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [{ login: 'user1' }, { login: 'user2' }],
        requested_teams: []
      }
    })

    await run()

    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['user1', 'user2']
      }
    )
  })

  it('Handles only team reviewers', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return ''
        case 'team-reviewers':
          return 'team1,team2'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [],
        requested_teams: [{ slug: 'team1' }, { slug: 'team2' }]
      }
    })

    await run()

    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        team_reviewers: ['team1', 'team2']
      }
    )
  })

  it('Fails when branch input is missing', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return ''
        case 'reviewers':
          return 'user1,user2'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Branch input is required')
  })

  it('Fails when no reviewers are provided', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return ''
        case 'team-reviewers':
          return ''
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'At least one of reviewers, team-reviewers, or use-codeowners must be provided'
    )
  })

  it('Handles API errors gracefully', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return 'user1,user2'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockRejectedValue(
      new Error('API Error: User not found')
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('API Error: User not found')
  })

  it('Successfully uses CODEOWNERS to add reviewers', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'use-codeowners':
          return 'true'
        case 'codeowners-branch':
          return 'main'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    // Mock changed files
    github.mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'src/main.js' }, { filename: 'docs/README.md' }]
    })

    // Mock CODEOWNERS file content
    const codeownersContent = Buffer.from(
      '# CODEOWNERS\n' +
        'src/ @developer1 @org/frontend-team\n' +
        'docs/ @tech-writer\n' +
        '* @admin'
    ).toString('base64')

    github.mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: codeownersContent
      }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [
          { login: 'developer1' },
          { login: 'tech-writer' },
          { login: 'admin' }
        ],
        requested_teams: [{ slug: 'frontend-team' }]
      }
    })

    await run()

    // Verify CODEOWNERS file was fetched
    expect(github.mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      path: 'CODEOWNERS',
      ref: 'main'
    })

    // Verify changed files were fetched
    expect(github.mockOctokit.rest.pulls.listFiles).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123
    })

    // Verify reviewers were requested (admin matches * pattern)
    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: expect.arrayContaining([
          'developer1',
          'tech-writer',
          'admin'
        ]),
        team_reviewers: ['frontend-team']
      }
    )
  })

  it('Combines CODEOWNERS reviewers with input reviewers', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return 'manual-reviewer'
        case 'team-reviewers':
          return 'manual-team'
        case 'use-codeowners':
          return 'true'
        case 'codeowners-branch':
          return 'main'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'src/main.js' }]
    })

    const codeownersContent = Buffer.from('src/ @codeowner1').toString('base64')
    github.mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { content: codeownersContent }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [
          { login: 'manual-reviewer' },
          { login: 'codeowner1' }
        ],
        requested_teams: [{ slug: 'manual-team' }]
      }
    })

    await run()

    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: expect.arrayContaining(['manual-reviewer', 'codeowner1']),
        team_reviewers: ['manual-team']
      }
    )
  })

  it('Removes PR author from reviewers list', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return 'pr-author,other-reviewer'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [{ login: 'other-reviewer' }],
        requested_teams: []
      }
    })

    await run()

    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['other-reviewer']
      }
    )
  })

  it('Handles missing CODEOWNERS file gracefully', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'use-codeowners':
          return 'true'
        case 'reviewers':
          return 'fallback-reviewer'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'src/main.js' }]
    })

    // Mock CODEOWNERS file not found
    github.mockOctokit.rest.repos.getContent.mockRejectedValue(
      new Error('Not Found')
    )

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [{ login: 'fallback-reviewer' }],
        requested_teams: []
      }
    })

    await run()

    // Should still add fallback reviewers
    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith(
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['fallback-reviewer']
      }
    )
  })

  it('Skips when no reviewers remain after filtering', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'reviewers':
          return 'pr-author' // Only the PR author
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    await run()

    // Should not call requestReviewers when all reviewers are filtered out
    expect(
      github.mockOctokit.rest.pulls.requestReviewers
    ).not.toHaveBeenCalled()
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('Uses custom codeowners branch', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'use-codeowners':
          return 'true'
        case 'codeowners-branch':
          return 'develop'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'src/main.js' }]
    })

    const codeownersContent = Buffer.from('src/ @developer').toString('base64')
    github.mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { content: codeownersContent }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [{ login: 'developer' }],
        requested_teams: []
      }
    })

    await run()

    // Verify CODEOWNERS was fetched from custom branch
    expect(github.mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      path: 'CODEOWNERS',
      ref: 'develop'
    })
  })

  it('Works with use-codeowners only (no manual reviewers)', async () => {
    core.getInput.mockImplementation((name) => {
      switch (name) {
        case 'branch':
          return 'main'
        case 'use-codeowners':
          return 'true'
        case 'token':
          return 'mock-token'
        default:
          return ''
      }
    })

    github.mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [{ filename: 'src/main.js' }]
    })

    const codeownersContent = Buffer.from('src/ @developer').toString('base64')
    github.mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { content: codeownersContent }
    })

    github.mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({
      data: {
        requested_reviewers: [{ login: 'developer' }],
        requested_teams: []
      }
    })

    await run()

    // Should not fail validation when only use-codeowners is provided
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(github.mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalled()
  })
})
