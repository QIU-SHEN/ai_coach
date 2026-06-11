import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface RadarChartProps {
  data: {
    subject: string;
    score: number;
    threshold: number;
  }[];
}

export function RadarChartComponent({ data }: RadarChartProps) {
  return (
    <div className="relative h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#4b5563', fontSize: 12 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 10 }} />
          <Radar
            name="当前得分"
            dataKey="score"
            stroke="#2563eb"
            fill="#2563eb"
            fillOpacity={0.3}
          />
          <Radar
            name="合格线"
            dataKey="threshold"
            stroke="#10b981"
            fill="#10b981"
            fillOpacity={0.1}
            strokeDasharray="4 4"
          />
          <Legend verticalAlign="bottom" height={24} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
