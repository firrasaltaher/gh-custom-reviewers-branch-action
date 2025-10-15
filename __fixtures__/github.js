/**
 * This file is used to mock the `@actions/github` module in tests.
 */
import { jest } from '@jest/globals'

// Mock context object
export const context = {
  eventName: 'pull_request',
  repo: {
    owner: 'test-owner',
    repo: 'test-repo'
  },
  payload: {
    pull_request: {
      number: 123,
      base: {
        ref: 'main'
      },
      user: {
        login: 'pr-author'
      }
    }
  }
}

// Mock octokit with pull request methods
export const mockOctokit = {
  rest: {
    pulls: {
      requestReviewers: jest.fn(),
      listFiles: jest.fn()
    },
    repos: {
      getContent: jest.fn()
    }
  }
}

export const getOctokit = jest.fn(() => mockOctokit)
