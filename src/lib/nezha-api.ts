/**
 * 上游的接口层。函数签名与返回类型保持原样（组件、store 都按这些类型读数据），
 * 实现整体换成 src/monitor/ 的桥接层 —— 数据源从哪吒的 /api/v1/* 变成极简探针的 /api/*。
 */
import {
	bridgeFetchLoginUser,
	bridgeFetchMonitor,
	bridgeFetchServerGroup,
	bridgeFetchServerMetrics,
	bridgeFetchService,
	bridgeFetchSetting,
} from "@/monitor/bridge";
import type {
	LoginUserResponse,
	MetricPeriod,
	MetricType,
	MonitorResponse,
	ServerGroupResponse,
	ServerMetricsResponse,
	ServiceResponse,
	SettingResponse,
} from "@/types/nezha-api";

export type MonitorPeriod = "1d" | "7d" | "30d";

export const fetchServerGroup = (): Promise<ServerGroupResponse> =>
	bridgeFetchServerGroup();

export const fetchLoginUser = (): Promise<LoginUserResponse> =>
	bridgeFetchLoginUser();

export const fetchMonitor = (
	server_id: number,
	period?: MonitorPeriod,
): Promise<MonitorResponse> => bridgeFetchMonitor(server_id, period);

export const fetchService = (hours?: number): Promise<ServiceResponse> =>
	bridgeFetchService(hours);

export const fetchSetting = (): Promise<SettingResponse> =>
	bridgeFetchSetting();

export const fetchServerMetrics = (
	server_id: number,
	metric: MetricType,
	period?: MetricPeriod,
): Promise<ServerMetricsResponse> =>
	bridgeFetchServerMetrics(server_id, metric, period);
