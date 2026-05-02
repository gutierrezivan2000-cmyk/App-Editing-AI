import { Card, CardContent } from "@/components/ui/Card";

interface MetricsCardProps {
  label: string;
  value: number | string;
  icon: string;
  trend?: string;
}

export const MetricsCard = ({ label, value, icon, trend }: MetricsCardProps) => (
  <Card>
    <CardContent className="flex items-start gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-50 text-2xl">
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {trend && <p className="text-xs text-gray-400">{trend}</p>}
      </div>
    </CardContent>
  </Card>
);
