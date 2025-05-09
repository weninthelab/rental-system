import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UserProfile } from 'src/database/entities/user-profile.entity';
import * as fs from 'fs';
import * as path from 'path';
import { CreateUserProfileDto } from './dto/create-user-profile.dto';
import { Op } from 'sequelize';

@Injectable()
export class RoommateService {
    private weightConfig: any;

    constructor(
        @InjectModel(UserProfile)
        private userProfileModel: typeof UserProfile,
    ) {
        const configPath = path.resolve(__dirname, '../../config/profile-weight-config.json');
        this.weightConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    async getAllProfiles(): Promise<UserProfile[]> {
        return this.userProfileModel.findAll();
    }

    async getProfileById(id: number): Promise<UserProfile> {
        const profile = await this.userProfileModel.findByPk(id);
        if (!profile) throw new NotFoundException('Profile not found');
        return profile;
    }

    async getProfileByUserId(userId: number): Promise<UserProfile> {
        const profile = await this.userProfileModel.findOne({
            where: {
                userId: { [Op.eq]: userId },
            },
        });
        if (!profile) throw new NotFoundException('Profile not found for this user');
        return profile;
    }

    async createProfile(
        userId: number,
        createUserProfileDto: CreateUserProfileDto,
    ): Promise<UserProfile> {
        const totalScore = this.calculateTotalScore(createUserProfileDto);

        const [profile, created] = await this.userProfileModel.upsert({
            ...createUserProfileDto,
            userId,
            totalScore, // Update total score after created profile
        });

        return profile;
    }

    private calculateTotalScore(profile: Partial<UserProfile>): number {
        let score = 0;
        for (const key in this.weightConfig) {
            if (profile[key] !== undefined) {
                const value = profile[key].toString();
                score += this.weightConfig[key][value] || 0;
            }
        }
        return score;
    }

    private getTimeGapInHours(time1: string, time2: string): number {
        const [h1, m1] = time1.split(':').map(Number);
        const [h2, m2] = time2.split(':').map(Number);
        const minutes1 = h1 * 60 + m1;
        const minutes2 = h2 * 60 + m2;
        return Math.abs(minutes1 - minutes2) / 60;
    }

    private calculateSimilarityScore(profileA: UserProfile, profileB: UserProfile): number {
        let scoreA = this.calculateTotalScore(profileA);
        let scoreB = this.calculateTotalScore(profileB);

        if (Math.abs(profileA.age - profileB.age) <= 1) {
            scoreA += 1;
            scoreB += 1;
        }

        if (this.getTimeGapInHours(profileA.wakeUpTime, profileB.wakeUpTime) <= 1) {
            scoreA += 1;
            scoreB += 1;
        }

        if (this.getTimeGapInHours(profileA.bedTime, profileB.bedTime) <= 1) {
            scoreA += 1;
            scoreB += 1;
        }

        const similarity = 1 / (1 + Math.abs(scoreA - scoreB));
        return similarity;
    }

    async getRoommateSuggestions(userId: number, topN = 5): Promise<UserProfile[]> {
      
        const currentUser = await this.userProfileModel.findOne({
            where: {
                userId: { [Op.eq]: userId },
            },
        });
     
        if (!currentUser) {
            throw new Error('User profile not found');
        }

        const allProfiles = await this.userProfileModel.findAll({
            where: {
                userId: { [Op.ne]: userId }, // Exclude current user
            },
        });
       
        const scoredProfiles = allProfiles.map(profile => ({
            profile,
            similarity: this.calculateSimilarityScore(currentUser, profile),
        }));

        scoredProfiles.sort((a, b) => b.similarity - a.similarity);

        return scoredProfiles.slice(0, topN).map(item => item.profile);
    }
}
