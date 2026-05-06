from datetime import date, timedelta
from dataclasses import dataclass
from typing import Optional


@dataclass
class Period:
    start: date
    end: date
    label: str
    granularity: str  # 'daily' | 'weekly' | 'monthly'

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1


def resolve(
    preset: str,
    custom_start: Optional[date] = None,
    custom_end: Optional[date] = None,
    today: Optional[date] = None,
) -> Period:
    if today is None:
        today = date.today()

    if preset == "last_7_days":
        start, end = today - timedelta(days=6), today
        label = "7 derniers jours"
    elif preset == "last_30_days":
        start, end = today - timedelta(days=29), today
        label = "30 derniers jours"
    elif preset == "last_90_days":
        start, end = today - timedelta(days=89), today
        label = "90 derniers jours"
    elif preset == "this_week":
        start = today - timedelta(days=today.weekday())
        end = today
        label = "Cette semaine"
    elif preset == "last_week":
        start = today - timedelta(days=today.weekday() + 7)
        end = start + timedelta(days=6)
        label = "Semaine dernière"
    elif preset == "this_month":
        start = today.replace(day=1)
        end = today
        label = "Ce mois"
    elif preset == "last_month":
        first = today.replace(day=1)
        end = first - timedelta(days=1)
        start = end.replace(day=1)
        label = "Mois dernier"
    elif preset == "ytd":
        start = today.replace(month=1, day=1)
        end = today
        label = "Année en cours"
    elif preset == "custom":
        if not custom_start or not custom_end:
            start, end = today - timedelta(days=29), today
        else:
            start, end = custom_start, custom_end
        label = f"{start.strftime('%d/%m/%Y')} – {end.strftime('%d/%m/%Y')}"
    else:
        start, end = today - timedelta(days=29), today
        label = "30 derniers jours"

    return Period(start=start, end=end, label=label, granularity=_granularity(start, end))


def comparison_period(period: Period) -> Period:
    duration = (period.end - period.start).days
    end = period.start - timedelta(days=1)
    start = end - timedelta(days=duration)
    label = f"{start.strftime('%d/%m/%Y')} – {end.strftime('%d/%m/%Y')}"
    return Period(start=start, end=end, label=label, granularity=period.granularity)


def _granularity(start: date, end: date) -> str:
    days = (end - start).days
    if days <= 30:
        return "daily"
    if days <= 180:
        return "weekly"
    return "monthly"
