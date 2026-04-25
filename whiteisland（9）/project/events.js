var events_c12a15a8_c380_4b28_8144_256cba95f760 = 
{
	"commonEvent": {
		"加点事件": [
			{
				"type": "comment",
				"text": "通过传参，flag:arg1 表示当前应该的加点数值"
			},
			{
				"type": "choices",
				"choices": [
					{
						"text": "攻击+${1*flag:arg1}",
						"action": [
							{
								"type": "setValue",
								"name": "status:atk",
								"operator": "+=",
								"value": "1*flag:arg1"
							}
						]
					},
					{
						"text": "防御+${2*flag:arg1}",
						"action": [
							{
								"type": "setValue",
								"name": "status:def",
								"operator": "+=",
								"value": "2*flag:arg1"
							}
						]
					},
					{
						"text": "生命+${200*flag:arg1}",
						"action": [
							{
								"type": "setValue",
								"name": "status:hp",
								"operator": "+=",
								"value": "200*flag:arg1"
							}
						]
					}
				]
			}
		],
		"回收钥匙商店": [
			{
				"type": "comment",
				"text": "此事件在全局商店中被引用了(全局商店keyShop)"
			},
			{
				"type": "comment",
				"text": "解除引用前勿删除此事件"
			},
			{
				"type": "comment",
				"text": "玩家在快捷列表（V键）中可以使用本公共事件"
			},
			{
				"type": "while",
				"condition": "1",
				"data": [
					{
						"type": "choices",
						"text": "\t[商人,trader]你有多余的钥匙想要出售吗？",
						"choices": [
							{
								"text": "黄钥匙（10金币）",
								"color": [
									255,
									255,
									0,
									1
								],
								"action": [
									{
										"type": "if",
										"condition": "item:yellowKey >= 1",
										"true": [
											{
												"type": "setValue",
												"name": "item:yellowKey",
												"operator": "-=",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "status:money",
												"operator": "+=",
												"value": "10"
											}
										],
										"false": [
											"\t[商人,trader]你没有黄钥匙！"
										]
									}
								]
							},
							{
								"text": "蓝钥匙（50金币）",
								"color": [
									0,
									0,
									255,
									1
								],
								"action": [
									{
										"type": "if",
										"condition": "item:blueKey >= 1",
										"true": [
											{
												"type": "setValue",
												"name": "item:blueKey",
												"operator": "-=",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "status:money",
												"operator": "+=",
												"value": "50"
											}
										],
										"false": [
											"\t[商人,trader]你没有蓝钥匙！"
										]
									}
								]
							},
							{
								"text": "离开",
								"action": [
									{
										"type": "exit"
									}
								]
							}
						]
					}
				]
			}
		],
		"超越 - 初阶": [
			{
				"type": "choices",
				"text": "准备好将自身的领悟臻至极致了吗？\n请选择要进行【超越】的领悟！\n\r[gold]初阶领悟可以进行3次超越，前两次提升基础效力的1/4，第三次提升基础效力的1/2。\r",
				"choices": [
					{
						"text": "${Math.pow(2,flag:liuli)*15} 琉璃【当前为${flag:liuli}次超越】",
						"icon": "I601",
						"color": [
							117,
							144,
							122,
							1
						],
						"condition": "flag:liuli<3",
						"action": [
							{
								"type": "if",
								"condition": "(item:I601==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:liuli)*15)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:liuli)*15"
													},
													{
														"type": "setValue",
														"name": "item:I752",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I601",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:liuli",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:liuli",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:liuli)*15)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:liuli)*15"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I753",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I752",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:liuli",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:liuli)*15)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:liuli)*15"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I754",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I753",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:liuli",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:miguo)*20} 秘果【当前为${flag:miguo}次超越】",
						"icon": "I602",
						"color": [
							216,
							209,
							145,
							1
						],
						"condition": "flag:miguo<3",
						"action": [
							{
								"type": "if",
								"condition": "(item:I602==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:miguo)*20)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:miguo)*20"
													},
													{
														"type": "setValue",
														"name": "item:I755",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I602",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:miguo",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:miguo",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:miguo)*20)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:miguo)*20"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I756",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I755",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:miguo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:miguo)*20)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:miguo)*20"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I757",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I756",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:miguo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:qingling)*25} 清灵【当前为${flag:qingling}次超越】",
						"icon": "I588",
						"color": [
							141,
							228,
							144,
							1
						],
						"condition": "flag:qingling<3",
						"action": [
							{
								"type": "if",
								"condition": "(item:I588==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:qingling)*25)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:qingling)*25"
													},
													{
														"type": "setValue",
														"name": "item:I743",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I588",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:qingling",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:qingling",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:qingling)*25)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:qingling)*25"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I744",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I743",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:qingling",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:qingling)*25)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:qingling)*25"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I745",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I744",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:qingling",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:xueyu)*30} 血雨【当前为${flag:xueyu}次超越】",
						"icon": "I590",
						"color": [
							228,
							141,
							175,
							1
						],
						"condition": "flag:xueyu<3",
						"action": [
							{
								"type": "if",
								"condition": "(item:I590==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:xueyu)*30)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:xueyu)*30"
													},
													{
														"type": "setValue",
														"name": "item:I749",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I590",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:xueyu",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:xueyu",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:xueyu)*30)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:xueyu)*30"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I750",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I749",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:xueyu",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:xueyu)*30)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:xueyu)*30"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I751",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I750",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:xueyu",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:leicai)*40} 雷裁【当前为${flag:leicai}次超越】",
						"icon": "I589",
						"color": [
							187,
							141,
							228,
							1
						],
						"condition": "flag:leicai<3",
						"action": [
							{
								"type": "if",
								"condition": "(item:I589==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:leicai)*40)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:leicai)*40"
													},
													{
														"type": "setValue",
														"name": "item:I746",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I589",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:leicai",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:leicai",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:leicai)*40)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:leicai)*40"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I747",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I746",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:leicai",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:leicai)*40)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:leicai)*40"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I748",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I747",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:leicai",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "离去…",
						"condition": "EvalString_default",
						"action": []
					}
				]
			}
		],
		"升华 - 初阶": [
			{
				"type": "choices",
				"text": "可以在此进行初阶领悟升华。\n每进行一次初阶升华，\n\r[gold]你的三围属性都将得到一个0.1倍的加成。\r",
				"choices": [
					{
						"text": "清灵、琉璃、秘果 - 琉璃灵果",
						"color": [
							74,
							178,
							130,
							1
						],
						"condition": "flag:chujie1==0",
						"action": [
							{
								"type": "choices",
								"text": "琉璃灵果：\n进阶层次的战复术，能够进行战地急救。\n战前恢复相当于对手攻防之和8倍的生命，并使每点护盾的效力提升为3倍。\n升华后，用于升华的低阶技能都将消失。\n确定要升华为该技能吗？",
								"choices": [
									{
										"text": "是",
										"color": [
											255,
											215,
											0,
											1
										],
										"action": [
											{
												"type": "setValue",
												"name": "item:I745",
												"value": "0"
											},
											{
												"type": "setValue",
												"name": "item:I754",
												"value": "0"
											},
											{
												"type": "setValue",
												"name": "item:I757",
												"value": "0"
											},
											{
												"type": "setValue",
												"name": "item:I591",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "flag:chujie1",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "flag:chujieshenghua",
												"operator": "+=",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "item:I821",
												"operator": "+=",
												"value": "0.1"
											},
											"升华成功！\n此后该项将不再显示在升华面板中。"
										]
									},
									{
										"text": "否",
										"color": [
											255,
											0,
											47,
											1
										],
										"action": []
									}
								]
							}
						]
					},
					{
						"text": "雷裁、血雨 - 唤雨雷暴",
						"color": [
							154,
							59,
							160,
							1
						],
						"condition": "flag:chujie2==0",
						"action": [
							{
								"type": "choices",
								"text": "唤雨雷暴：\n技艺纯熟的魔导士的领悟，能影响一定范围内的天气。\n每回合以50%的伤害发动三次攻击（不受超越影响），并使对方每回合损失最大生命的千分之2，生命损失持续100回合。\n升华后，用于升华的低阶技能都将消失。\n确定要升华为该技能吗？",
								"choices": [
									{
										"text": "是",
										"color": [
											255,
											215,
											0,
											1
										],
										"action": [
											{
												"type": "setValue",
												"name": "item:I748",
												"value": "0"
											},
											{
												"type": "setValue",
												"name": "item:I751",
												"value": "0"
											},
											{
												"type": "setValue",
												"name": "item:I592",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "flag:chujie2",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "flag:chujieshenghua",
												"operator": "+=",
												"value": "1"
											},
											{
												"type": "setValue",
												"name": "item:I821",
												"operator": "+=",
												"value": "0.1"
											},
											"升华成功！\n此后该项将不再显示在升华面板中。"
										]
									},
									{
										"text": "否",
										"color": [
											255,
											0,
											47,
											1
										],
										"action": []
									}
								]
							}
						]
					},
					{
						"text": "离去…",
						"color": [
							255,
							255,
							255,
							1
						],
						"action": []
					}
				]
			}
		],
		"进入心之境界": [
			{
				"type": "changeFloor",
				"floorId": "Heart",
				"loc": [
					6,
					8
				],
				"direction": "down"
			}
		],
		"超越 - 中阶": [
			{
				"type": "choices",
				"text": "请选择要进行【超越】的领悟！\n\r[gold]中阶领悟可以进行5次超越，前两次提升基础效力的1/5，后三次提升基础效力的1/4。\n如果是包含上限值的领悟，则第1、2、5次提升基础效力，第3、4次提升上限。\r",
				"choices": [
					{
						"text": "${Math.pow(2,flag:yuyanzhe)*1000} 预言者【当前为${flag:yuyanzhe}次超越】",
						"icon": "I596",
						"color": [
							141,
							210,
							228,
							1
						],
						"condition": "flag:yuyanzhe<5",
						"action": [
							{
								"type": "if",
								"condition": "(item:I596==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:yuyanzhe)*1000)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:yuyanzhe)*1000"
													},
													{
														"type": "setValue",
														"name": "item:I832",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I596",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:yuyanzhe",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:yuyanzhe",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:yuyanzhe)*1000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:yuyanzhe)*1000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I833",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I832",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:yuyanzhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:yuyanzhe)*1000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:yuyanzhe)*1000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I834",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I833",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:yuyanzhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "3",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:yuyanzhe)*1000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:yuyanzhe)*1000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I835",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I834",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:yuyanzhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "4",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:yuyanzhe)*1000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:yuyanzhe)*1000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I836",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I835",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:yuyanzhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:tunshizhe)*2000} 吞食者【当前为${flag:tunshizhe}次超越】",
						"icon": "I597",
						"color": [
							236,
							126,
							101,
							1
						],
						"condition": "flag:tunshizhe<5",
						"action": [
							{
								"type": "if",
								"condition": "(item:I597==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:tunshizhe)*2000)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:tunshizhe)*2000"
													},
													{
														"type": "setValue",
														"name": "item:I837",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I597",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:tunshizhe",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:tunshizhe",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:tunshizhe)*2000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:tunshizhe)*2000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I838",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I837",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:tunshizhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:tunshizhe)*2000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:tunshizhe)*2000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I839",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I838",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:tunshizhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "3",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:tunshizhe)*2000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:tunshizhe)*2000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I840",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I839",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:tunshizhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "4",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:tunshizhe)*2000)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:tunshizhe)*2000"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I841",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I840",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:tunshizhe",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:kanshui)*2500} 坎水【当前为${flag:kanshui}次超越】",
						"icon": "I595",
						"color": [
							141,
							152,
							228,
							1
						],
						"condition": "flag:kanshui<5",
						"action": [
							{
								"type": "if",
								"condition": "(item:I595==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:kanshui)*2500)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:kanshui)*2500"
													},
													{
														"type": "setValue",
														"name": "item:I827",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I595",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:kanshui",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:kanshui",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:kanshui)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:kanshui)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I828",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I827",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:kanshui",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:kanshui)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:kanshui)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I829",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I828",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:kanshui",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "3",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:kanshui)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:kanshui)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I830",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I829",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:kanshui",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "4",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:kanshui)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:kanshui)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I831",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I830",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:kanshui",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:liulilingguo)*2500} 琉璃灵果【当前为${flag:liulilingguo}次超越】",
						"icon": "I591",
						"color": [
							66,
							239,
							46,
							1
						],
						"condition": "flag:liulilingguo<5",
						"action": [
							{
								"type": "if",
								"condition": "(item:I591==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:liulilingguo)*2500)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:liulilingguo)*2500"
													},
													{
														"type": "setValue",
														"name": "item:I842",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I591",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:liulilingguo",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:liulilingguo",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:liulilingguo)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:liulilingguo)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I843",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I842",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:liulilingguo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:liulilingguo)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:liulilingguo)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I844",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I843",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:liulilingguo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "3",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:liulilingguo)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:liulilingguo)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I845",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I844",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:liulilingguo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "4",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:liulilingguo)*2500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:liulilingguo)*2500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I846",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I845",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:liulilingguo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:lihuo)*3500} 离火【当前为${flag:lihuo}次超越】",
						"icon": "I594",
						"color": [
							234,
							52,
							89,
							1
						],
						"condition": "flag:lihuo<5",
						"action": [
							{
								"type": "if",
								"condition": "(item:I594==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:lihuo)*3500)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:lihuo)*3500"
													},
													{
														"type": "setValue",
														"name": "item:I822",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I594",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:lihuo",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:lihuo",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:lihuo)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:lihuo)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I823",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I822",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:lihuo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:lihuo)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:lihuo)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I824",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I823",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:lihuo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "3",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:lihuo)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:lihuo)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I825",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I824",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:lihuo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "4",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:lihuo)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:lihuo)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I826",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I825",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:lihuo",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "${Math.pow(2,flag:xueyuleibao)*3500} 唤雨雷暴【当前为${flag:xueyuleibao}次超越】",
						"icon": "I592",
						"color": [
							197,
							97,
							243,
							1
						],
						"condition": "flag:xueyuleibao<5",
						"action": [
							{
								"type": "if",
								"condition": "(item:I592==1)",
								"true": [
									{
										"type": "confirm",
										"default": true,
										"text": "确认要超越当前领悟吗？",
										"yes": [
											{
												"type": "if",
												"condition": "(status:money>=Math.pow(2,flag:xueyuleibao)*3500)",
												"true": [
													{
														"type": "setValue",
														"name": "status:money",
														"operator": "-=",
														"value": "Math.pow(2,flag:xueyuleibao)*3500"
													},
													{
														"type": "setValue",
														"name": "item:I847",
														"operator": "+=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "item:I592",
														"operator": "-=",
														"value": "1"
													},
													{
														"type": "setValue",
														"name": "flag:xueyuleibao",
														"operator": "+=",
														"value": "1"
													},
													"超越成功！"
												],
												"false": [
													"领悟点数不足。"
												]
											}
										],
										"no": []
									}
								],
								"false": [
									{
										"type": "switch",
										"condition": "flag:xueyuleibao",
										"caseList": [
											{
												"case": "0",
												"action": [
													"未获得该领悟。",
													{
														"type": "comment",
														"text": "当判别值是值的场合执行此事件"
													}
												]
											},
											{
												"case": "1",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:xueyuleibao)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:xueyuleibao)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I848",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I847",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:xueyuleibao",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "2",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:xueyuleibao)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:xueyuleibao)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I849",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I848",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:xueyuleibao",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "3",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:xueyuleibao)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:xueyuleibao)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I850",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I849",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:xueyuleibao",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											},
											{
												"case": "4",
												"action": [
													{
														"type": "confirm",
														"default": true,
														"text": "确认要超越当前领悟吗？",
														"yes": [
															{
																"type": "if",
																"condition": "(status:money>=Math.pow(2,flag:xueyuleibao)*3500)",
																"true": [
																	{
																		"type": "setValue",
																		"name": "status:money",
																		"operator": "-=",
																		"value": "Math.pow(2,flag:xueyuleibao)*3500"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I851",
																		"operator": "+=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "item:I850",
																		"operator": "-=",
																		"value": "1"
																	},
																	{
																		"type": "setValue",
																		"name": "flag:xueyuleibao",
																		"operator": "+=",
																		"value": "1"
																	},
																	"超越成功！",
																	"该领悟至此达到最大等级！\n之后将不再显示在超越事件中。"
																],
																"false": [
																	"领悟点数不足。"
																]
															}
														],
														"no": []
													}
												]
											}
										]
									}
								]
							}
						]
					},
					{
						"text": "离去…",
						"condition": "EvalString_default",
						"action": []
					}
				]
			}
		],
		"清空状态": [
			{
				"type": "function",
				"function": "function(){\ncore.setFlag(\"__visited__\", {});\n}"
			},
			{
				"type": "unfollow",
				"name": "nanami.png"
			},
			{
				"type": "unloadEquip",
				"pos": 0
			},
			{
				"type": "unloadEquip",
				"pos": 1
			},
			{
				"type": "unloadEquip",
				"pos": 2
			},
			{
				"type": "unloadEquip",
				"pos": 3
			},
			{
				"type": "unloadEquip",
				"pos": 4
			},
			{
				"type": "unloadEquip",
				"pos": 5
			},
			{
				"type": "setValue",
				"name": "item:I893",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I894",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I895",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I896",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I897",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I898",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I899",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I900",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I901",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I920",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I921",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I922",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I923",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I924",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I925",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I926",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I927",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I928",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I929",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I930",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I931",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I932",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I933",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I934",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I935",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I936",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I937",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I938",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I939",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I977",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I978",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I979",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I980",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I981",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I982",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I983",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I1124",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I1125",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I1126",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I1127",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I821",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:superPotion",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:superWine",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:bigKey",
				"value": "0"
			},
			{
				"type": "setValue",
				"name": "item:I600",
				"value": "1"
			}
		]
	}
}