import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import type {
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react'
import { cx } from '../utils/cx.js'

const ListContext = createContext<{ selectable: boolean }>({ selectable: false })

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  /** Makes the list a `listbox` with roving tabindex and arrow-key navigation. */
  selectable?: boolean
  children?: ReactNode
}

function getEnabledOptions(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-navin-list-option]')).filter(
    (option) => option.getAttribute('aria-disabled') !== 'true',
  )
}

function useRovingTabindex(ref: RefObject<HTMLUListElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const list = ref.current
    if (!list || !enabled) return
    const options = Array.from(list.querySelectorAll<HTMLElement>('[data-navin-list-option]'))
    if (options.length === 0) return
    const activeOption = options.find((option) => option.getAttribute('tabindex') === '0')
    if (activeOption && activeOption.getAttribute('aria-disabled') !== 'true') return
    const activeIndex = activeOption ? options.indexOf(activeOption) : -1
    const isEnabled = (option: HTMLElement) => option.getAttribute('aria-disabled') !== 'true'
    const firstEnabled =
      activeIndex >= 0
        ? (options.slice(activeIndex + 1).find(isEnabled) ??
          options.slice(0, activeIndex).find(isEnabled))
        : options.find(isEnabled)
    for (const option of options) {
      option.setAttribute('tabindex', '-1')
    }
    firstEnabled?.setAttribute('tabindex', '0')
    if (activeOption && document.activeElement === activeOption) {
      firstEnabled?.focus()
    }
  })
}

export function List({ selectable = false, className, children, onKeyDown, ...rest }: ListProps) {
  const listRef = useRef<HTMLUListElement | null>(null)

  useRovingTabindex(listRef, selectable)

  const moveFocus = (index: number) => {
    const list = listRef.current
    if (!list) return
    const options = getEnabledOptions(list)
    const target = options[index]
    if (!target) return
    for (const option of options) {
      option.setAttribute('tabindex', '-1')
    }
    target.setAttribute('tabindex', '0')
    target.focus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(event)
    if (!selectable || event.defaultPrevented) return
    const list = listRef.current
    if (!list) return
    const options = getEnabledOptions(list)
    if (options.length === 0) return
    const activeIndex = options.indexOf(document.activeElement as HTMLElement)
    let nextIndex: number
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, options.length - 1)
        break
      case 'ArrowUp':
        nextIndex = activeIndex < 0 ? options.length - 1 : Math.max(activeIndex - 1, 0)
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = options.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    moveFocus(nextIndex)
  }

  return (
    <ListContext.Provider value={{ selectable }}>
      <ul
        {...rest}
        ref={listRef}
        role={selectable ? 'listbox' : 'list'}
        className={cx('navin-list', className)}
        onKeyDown={handleKeyDown}
      >
        {children}
      </ul>
    </ListContext.Provider>
  )
}

export interface ListRowProps extends Omit<HTMLAttributes<HTMLLIElement>, 'onSelect' | 'title'> {
  title?: ReactNode
  description?: ReactNode
  meta?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  selected?: boolean
  disabled?: boolean
  onActivate?: () => void
}

export function ListRow({
  title,
  description,
  meta,
  leading,
  trailing,
  selected = false,
  disabled = false,
  onActivate,
  className,
  children,
  onClick,
  onKeyDown,
  role,
  tabIndex,
  ...rest
}: ListRowProps) {
  const { selectable } = useContext(ListContext)
  const interactive = Boolean(onActivate || onClick)
  const rowRole = selectable ? 'option' : interactive ? 'button' : role
  const rowTabIndex = selectable ? undefined : interactive ? (disabled ? -1 : 0) : tabIndex

  const handleClick = (event: ReactMouseEvent<HTMLLIElement>) => {
    if (disabled) return
    onClick?.(event)
    onActivate?.()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>) => {
    onKeyDown?.(event)
    if (disabled) return
    if (
      !event.defaultPrevented &&
      (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')
    ) {
      event.preventDefault()
      event.currentTarget.click()
    }
  }

  return (
    <li
      {...rest}
      role={rowRole}
      tabIndex={rowTabIndex}
      aria-selected={selectable ? selected : undefined}
      aria-disabled={disabled ? true : undefined}
      data-navin-list-option={selectable ? '' : undefined}
      className={cx(
        'navin-list-row',
        selected && 'navin-list-row--selected',
        disabled && 'navin-list-row--disabled',
        className,
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {leading ? (
        <span className="navin-list-row__leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="navin-list-row__main">
        {title ? (
          <span
            className="navin-list-row__title"
            title={typeof title === 'string' ? title : undefined}
          >
            {title}
          </span>
        ) : null}
        {description ? (
          <span
            className="navin-list-row__description"
            title={typeof description === 'string' ? description : undefined}
          >
            {description}
          </span>
        ) : null}
        {children}
      </span>
      {meta ? <span className="navin-list-row__meta">{meta}</span> : null}
      {trailing ? <span className="navin-list-row__trailing">{trailing}</span> : null}
    </li>
  )
}
