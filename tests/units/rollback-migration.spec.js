const { rollbackMigration } = require('../../src/tasks/')
const {
  checkExistenceFilesInRollBackDirectory,
  createRollbackFile
} = require('../../src/tasks/migrations/utils')

const FAKE_PATH = `${process.cwd()}/migrations/rollback`
const { FAKE_STORIES } = require('../constants')

const story = {
  ...FAKE_STORIES()[0]
}

const URL = 'https://api.storyblok.com/v1/'

jest.mock('fs-extra')

const FAKE_API = {
  getClient: jest.fn(() => Promise.resolve({
    oauthToken: process.env.STORYBLOK_TOKEN
  }, URL)),
  put: jest.fn(() => Promise.resolve(story))
}

describe('testing rollbackMigration', () => {
  it('test function to createRollbackFile', async () => {
    return createRollbackFile([story], 'page', 'body')
      .then(data => {
        expect(data.component).toBe('page')
        expect(data.created).toBe(true)
      })
  })

  it('teste function to checkExistenceFilesInRollBackDirectory', async () => {
    checkExistenceFilesInRollBackDirectory(FAKE_PATH, 'page', 'body')
      .then(data => {
        expect(data).toStrictEqual(['rollback_page_body.json'])
      })
  })

  it('test function to rollbackMigration', () => {
    rollbackMigration(FAKE_API, 'body', 'page')
      .then(data => {
        expect(data).toEqual({ rollback: true })
      })
  })
})
