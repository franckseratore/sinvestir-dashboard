'use client'
import { useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  filterPlaceholder?: string
  filterKey?: string
  className?: string
  exportFilename?: string
}

function exportToCsv<T>(rows: T[], columns: ColumnDef<T, unknown>[], filename: string) {
  const headers = columns
    .map((c) => (typeof c.header === 'string' ? c.header : String((c as { accessorKey?: string }).accessorKey ?? '')))
    .join(',')
  const lines = rows.map((row) =>
    columns.map((c) => {
      const key = (c as { accessorKey?: string }).accessorKey
      if (!key) return ''
      const val = (row as Record<string, unknown>)[key]
      const str = val == null ? '' : String(val)
      return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
    }).join(',')
  )
  const csv = [headers, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function DataTable<T>({ columns, data, filterPlaceholder, filterKey, className, exportFilename }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className={cn('space-y-3', className)}>
      {(filterPlaceholder || exportFilename) && (
        <div className="flex items-center justify-between gap-3">
          {filterPlaceholder ? (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={filterPlaceholder}
                className="w-full max-w-xs rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-700 outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
              />
            </div>
          ) : <div />}
          {exportFilename && (
            <button
              onClick={() => exportToCsv(table.getFilteredRowModel().rows.map((r) => r.original), columns, exportFilename)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 transition-colors"
            >
              <Download size={12} />
              Exporter CSV
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-zinc-100">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={cn(
                      'px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-500 select-none',
                      header.column.getCanSort() && 'cursor-pointer hover:text-brand'
                    )}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="text-zinc-300">
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUp size={12} className="text-brand" />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ChevronDown size={12} className="text-brand" />
                          ) : (
                            <ChevronsUpDown size={12} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-zinc-400">
                  Aucune donnée sur cette période
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={cn('border-b border-zinc-50 last:border-0 hover:bg-zinc-50 transition-colors', i % 2 === 1 && 'bg-zinc-50/50')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-zinc-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
