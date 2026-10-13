import { isNavigationFailure, NavigationFailureType, type Router } from 'vue-router'
import type { AskLink } from '@/assistant/types'

interface AnswerNavigation {
  router: Pick<Router, 'push'>
  link: AskLink
  close: () => void
}

/** 目标页落位后让出操作空间；同页链接也收起，取消或失败则保留回答。 */
export async function navigateFromAnswer(options: AnswerNavigation): Promise<boolean> {
  const { router, link, close } = options
  const failure = await router.push({ path: link.path, query: link.query })
  if (isNavigationFailure(failure)
    && !isNavigationFailure(failure, NavigationFailureType.duplicated)) return false
  close()
  return true
}
